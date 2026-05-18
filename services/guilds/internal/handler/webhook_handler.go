package handler

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type WebhookHandler struct {
	db           *sql.DB
	rdb          *redis.Client
	messagingURL string
}

func NewWebhookHandler(db *sql.DB, rdb *redis.Client, messagingURL string) *WebhookHandler {
	return &WebhookHandler{db: db, rdb: rdb, messagingURL: messagingURL}
}

func (h *WebhookHandler) RegisterRoutes(mux *http.ServeMux) {
	// Management (authenticated)
	mux.HandleFunc("GET /guilds/{id}/webhooks", h.ListWebhooks)
	mux.HandleFunc("POST /guilds/{id}/webhooks", h.CreateWebhook)
	mux.HandleFunc("PATCH /webhooks/{id}", h.UpdateWebhook)
	mux.HandleFunc("DELETE /webhooks/{id}", h.DeleteWebhook)

	// Execution (token-based, no auth needed)
	mux.HandleFunc("POST /webhooks/{id}/{token}", h.ExecuteWebhook)
}

type Webhook struct {
	ID        string    `json:"id"`
	GuildID   string    `json:"guildId"`
	ChannelID string    `json:"channelId"`
	CreatorID string    `json:"creatorId"`
	Name      string    `json:"name"`
	AvatarURL *string   `json:"avatarUrl,omitempty"`
	Token     string    `json:"token,omitempty"`
	URL       string    `json:"url"`
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"createdAt"`
}

func generateToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (h *WebhookHandler) ListWebhooks(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, guild_id, channel_id, creator_id, name, avatar_url, token, enabled, created_at
		FROM webhooks WHERE guild_id = $1 ORDER BY created_at`, guildID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	defer rows.Close()

	hooks := []Webhook{}
	for rows.Next() {
		var wh Webhook
		rows.Scan(&wh.ID, &wh.GuildID, &wh.ChannelID, &wh.CreatorID, &wh.Name, &wh.AvatarURL, &wh.Token, &wh.Enabled, &wh.CreatedAt)
		wh.URL = fmt.Sprintf("/webhooks/%s/%s", wh.ID, wh.Token)
		hooks = append(hooks, wh)
	}
	writeJSON(w, http.StatusOK, hooks)
}

func (h *WebhookHandler) CreateWebhook(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")

	var body struct {
		ChannelID string  `json:"channelId"`
		Name      string  `json:"name"`
		AvatarURL *string `json:"avatarUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid body")
		return
	}
	if body.Name == "" || body.ChannelID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "name and channelId required")
		return
	}

	// Limit: 10 webhooks per guild
	var count int
	h.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM webhooks WHERE guild_id = $1`, guildID).Scan(&count)
	if count >= 10 {
		writeError(w, http.StatusBadRequest, "LIMIT_REACHED", "max 10 webhooks per server")
		return
	}

	token := generateToken()
	var wh Webhook
	err := h.db.QueryRowContext(r.Context(), `
		INSERT INTO webhooks (guild_id, channel_id, creator_id, name, avatar_url, token)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, guild_id, channel_id, creator_id, name, avatar_url, token, enabled, created_at`,
		guildID, body.ChannelID, userID, body.Name, body.AvatarURL, token,
	).Scan(&wh.ID, &wh.GuildID, &wh.ChannelID, &wh.CreatorID, &wh.Name, &wh.AvatarURL, &wh.Token, &wh.Enabled, &wh.CreatedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	wh.URL = fmt.Sprintf("/webhooks/%s/%s", wh.ID, wh.Token)
	writeJSON(w, http.StatusCreated, wh)
}

func (h *WebhookHandler) UpdateWebhook(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUser(w, r)
	if !ok {
		return
	}
	webhookID := r.PathValue("id")

	var body struct {
		Name      *string `json:"name"`
		ChannelID *string `json:"channelId"`
		AvatarURL *string `json:"avatarUrl"`
		Enabled   *bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid body")
		return
	}

	// Read-modify-write
	var wh Webhook
	err := h.db.QueryRowContext(r.Context(), `
		SELECT id, guild_id, channel_id, creator_id, name, avatar_url, token, enabled, created_at
		FROM webhooks WHERE id = $1`, webhookID,
	).Scan(&wh.ID, &wh.GuildID, &wh.ChannelID, &wh.CreatorID, &wh.Name, &wh.AvatarURL, &wh.Token, &wh.Enabled, &wh.CreatedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "webhook not found")
		return
	}

	if body.Name != nil {
		wh.Name = *body.Name
	}
	if body.ChannelID != nil {
		wh.ChannelID = *body.ChannelID
	}
	if body.AvatarURL != nil {
		wh.AvatarURL = body.AvatarURL
	}
	if body.Enabled != nil {
		wh.Enabled = *body.Enabled
	}

	_, err = h.db.ExecContext(r.Context(), `
		UPDATE webhooks SET name=$1, channel_id=$2, avatar_url=$3, enabled=$4, updated_at=NOW() WHERE id=$5`,
		wh.Name, wh.ChannelID, wh.AvatarURL, wh.Enabled, webhookID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	wh.URL = fmt.Sprintf("/webhooks/%s/%s", wh.ID, wh.Token)
	writeJSON(w, http.StatusOK, wh)
}

func (h *WebhookHandler) DeleteWebhook(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUser(w, r)
	if !ok {
		return
	}
	webhookID := r.PathValue("id")
	h.db.ExecContext(r.Context(), `DELETE FROM webhooks WHERE id = $1`, webhookID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *WebhookHandler) ExecuteWebhook(w http.ResponseWriter, r *http.Request) {
	webhookID := r.PathValue("id")
	token := r.PathValue("token")

	// Validate token
	var channelID, guildID, name string
	var avatarURL *string
	var enabled bool
	err := h.db.QueryRowContext(r.Context(), `
		SELECT channel_id, guild_id, name, avatar_url, enabled FROM webhooks
		WHERE id = $1 AND token = $2`, webhookID, token,
	).Scan(&channelID, &guildID, &name, &avatarURL, &enabled)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "webhook not found or invalid token")
		return
	}
	if !enabled {
		writeError(w, http.StatusForbidden, "DISABLED", "webhook is disabled")
		return
	}

	var body struct {
		Content   string `json:"content"`
		Username  string `json:"username"`
		AvatarURL string `json:"avatar_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid body")
		return
	}
	if strings.TrimSpace(body.Content) == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "content required")
		return
	}

	// Use webhook name if no override
	displayName := name
	if body.Username != "" {
		displayName = body.Username
	}

	// Send message via messaging service
	msgPayload, _ := json.Marshal(map[string]interface{}{
		"content":       body.Content,
		"bridgeSource":  "webhook",
		"bridgeAuthor":  displayName,
		"bridgeAuthorId": webhookID,
	})

	targetURL := h.messagingURL + "/channels/" + channelID + "/messages"
	req, _ := http.NewRequestWithContext(r.Context(), "POST", targetURL, strings.NewReader(string(msgPayload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "webhook:"+webhookID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Error("webhook message failed", "error", err)
		writeError(w, http.StatusBadGateway, "PROXY_ERROR", "failed to send message")
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}
