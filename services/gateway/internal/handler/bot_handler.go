package handler

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/decatrondev/nexe/services/gateway/internal/middleware"
	"github.com/decatrondev/nexe/services/gateway/internal/model"
	"github.com/decatrondev/nexe/services/gateway/internal/repository"
	"github.com/decatrondev/nexe/services/gateway/internal/service"
)

type BotHandler struct {
	bots *repository.BotRepository
	jwt  *service.JWTService
}

func NewBotHandler(bots *repository.BotRepository, jwt *service.JWTService) *BotHandler {
	return &BotHandler{bots: bots, jwt: jwt}
}

// CreateApp registers a new bot application
func (h *BotHandler) CreateApp(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	var body struct {
		Name         string   `json:"name"`
		Description  *string  `json:"description"`
		RedirectURIs []string `json:"redirectUris"`
		Scopes       []string `json:"scopes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "name is required")
		return
	}

	if len(body.RedirectURIs) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_body", "at least one redirect URI is required")
		return
	}

	// Validate scopes
	for _, scope := range body.Scopes {
		if _, ok := model.ValidBotScopes[scope]; !ok {
			writeError(w, http.StatusBadRequest, "invalid_scope", fmt.Sprintf("unknown scope: %s", scope))
			return
		}
	}

	// Generate client ID and secret
	clientID := generateRandomHex(16)
	clientSecret := generateRandomHex(32)
	secretHash := hashString(clientSecret)

	app := &model.BotApplication{
		OwnerID:      claims.Subject,
		Name:         body.Name,
		Description:  body.Description,
		ClientID:     clientID,
		ClientSecret: secretHash, // store hash
		RedirectURIs: body.RedirectURIs,
		Scopes:       body.Scopes,
	}

	if err := h.bots.Create(r.Context(), app); err != nil {
		writeError(w, http.StatusInternalServerError, "create_error", err.Error())
		return
	}

	slog.Info("bot app created", "appId", app.ID, "name", body.Name, "owner", claims.Subject)

	// Return with plain secret (only time it's shown)
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"data": map[string]interface{}{
			"id":           app.ID,
			"name":         app.Name,
			"clientId":     clientID,
			"clientSecret": clientSecret, // shown once!
			"redirectUris": app.RedirectURIs,
			"scopes":       app.Scopes,
			"createdAt":    app.CreatedAt,
			"message":      "Save the clientSecret now — it won't be shown again",
		},
	})
}

// ListApps lists the authenticated user's bot applications
func (h *BotHandler) ListApps(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	apps, err := h.bots.ListByOwner(r.Context(), claims.Subject)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"data": apps})
}

// GetApp gets a specific bot application
func (h *BotHandler) GetApp(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	app, err := h.bots.GetByID(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "get_error", err.Error())
		return
	}
	if app == nil || app.OwnerID != claims.Subject {
		writeError(w, http.StatusNotFound, "not_found", "application not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"data": app})
}

// UpdateApp updates a bot application
func (h *BotHandler) UpdateApp(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	appID := r.PathValue("id")
	app, err := h.bots.GetByID(r.Context(), appID)
	if err != nil || app == nil || app.OwnerID != claims.Subject {
		writeError(w, http.StatusNotFound, "not_found", "application not found")
		return
	}

	var body struct {
		Name         string   `json:"name"`
		Description  *string  `json:"description"`
		RedirectURIs []string `json:"redirectUris"`
		Scopes       []string `json:"scopes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	if body.Name == "" {
		body.Name = app.Name
	}
	if body.RedirectURIs == nil {
		body.RedirectURIs = app.RedirectURIs
	}
	if body.Scopes == nil {
		body.Scopes = app.Scopes
	}

	if err := h.bots.Update(r.Context(), appID, body.Name, body.Description, body.RedirectURIs, body.Scopes); err != nil {
		writeError(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}

	updated, _ := h.bots.GetByID(r.Context(), appID)
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": updated})
}

// DeleteApp deletes a bot application
func (h *BotHandler) DeleteApp(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	app, err := h.bots.GetByID(r.Context(), r.PathValue("id"))
	if err != nil || app == nil || app.OwnerID != claims.Subject {
		writeError(w, http.StatusNotFound, "not_found", "application not found")
		return
	}

	if err := h.bots.Delete(r.Context(), app.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]string{"message": "application deleted"},
	})
}

// ResetSecret generates a new client secret
func (h *BotHandler) ResetSecret(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	app, err := h.bots.GetByID(r.Context(), r.PathValue("id"))
	if err != nil || app == nil || app.OwnerID != claims.Subject {
		writeError(w, http.StatusNotFound, "not_found", "application not found")
		return
	}

	newSecret := generateRandomHex(32)
	newHash := hashString(newSecret)

	if err := h.bots.ResetSecret(r.Context(), app.ID, newHash); err != nil {
		writeError(w, http.StatusInternalServerError, "reset_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]interface{}{
			"clientSecret": newSecret,
			"message":      "Save the new clientSecret now — it won't be shown again",
		},
	})
}

// TokenExchange handles client_credentials grant for bots
func (h *BotHandler) TokenExchange(w http.ResponseWriter, r *http.Request) {
	var body struct {
		GrantType    string `json:"grantType"`
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	if body.GrantType != "client_credentials" {
		writeError(w, http.StatusBadRequest, "invalid_grant", "only client_credentials grant is supported")
		return
	}

	app, storedHash, err := h.bots.GetByClientID(r.Context(), body.ClientID)
	if err != nil || app == nil {
		writeError(w, http.StatusUnauthorized, "invalid_client", "invalid client credentials")
		return
	}

	// Verify secret
	providedHash := hashString(body.ClientSecret)
	if providedHash != storedHash {
		writeError(w, http.StatusUnauthorized, "invalid_client", "invalid client credentials")
		return
	}

	// Generate bot access token (1 hour)
	token, err := h.jwt.GenerateAccessToken(app.ID, "bot:"+app.Name, "", "bot", "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": model.BotToken{
			AccessToken: token,
			TokenType:   "Bearer",
			ExpiresIn:   3600,
			Scopes:      app.Scopes,
		},
	})
}

// ListScopes returns all available bot scopes
func (h *BotHandler) ListScopes(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": model.ValidBotScopes,
	})
}

func generateRandomHex(length int) string {
	bytes := make([]byte, length)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// suppress unused import
var _ = time.Now
