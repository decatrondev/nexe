package handler

import (
	"encoding/json"
	"net/http"

	"github.com/decatrondev/nexe/services/guilds/internal/repository"
)

type PrivacyHandler struct {
	repo *repository.PrivacyRepository
}

func NewPrivacyHandler(repo *repository.PrivacyRepository) *PrivacyHandler {
	return &PrivacyHandler{repo: repo}
}

func (h *PrivacyHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /privacy", h.GetPrivacy)
	mux.HandleFunc("PUT /privacy", h.UpdatePrivacy)
	mux.HandleFunc("GET /guilds/{guildId}/dm-toggle", h.GetServerDMToggle)
	mux.HandleFunc("PUT /guilds/{guildId}/dm-toggle", h.SetServerDMToggle)
}

// GET /privacy
func (h *PrivacyHandler) GetPrivacy(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	settings, err := h.repo.GetOrDefault(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "privacy_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// PUT /privacy { "whoCanDm": "friends", "whoCanFriend": "everyone" }
func (h *PrivacyHandler) UpdatePrivacy(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	var body struct {
		WhoCanDM     *string `json:"whoCanDm"`
		WhoCanFriend *string `json:"whoCanFriend"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	settings, err := h.repo.GetOrDefault(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "privacy_error", err.Error())
		return
	}

	if body.WhoCanDM != nil {
		v := *body.WhoCanDM
		if v != "everyone" && v != "server_members" && v != "friends" {
			writeError(w, http.StatusBadRequest, "invalid_value", "whoCanDm must be everyone, server_members, or friends")
			return
		}
		settings.WhoCanDM = v
	}
	if body.WhoCanFriend != nil {
		v := *body.WhoCanFriend
		if v != "everyone" && v != "friends_of_friends" && v != "nobody" {
			writeError(w, http.StatusBadRequest, "invalid_value", "whoCanFriend must be everyone, friends_of_friends, or nobody")
			return
		}
		settings.WhoCanFriend = v
	}

	if err := h.repo.Upsert(r.Context(), settings); err != nil {
		writeError(w, http.StatusInternalServerError, "privacy_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, settings)
}

// GET /guilds/:guildId/dm-toggle
func (h *PrivacyHandler) GetServerDMToggle(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("guildId")

	allowed, err := h.repo.GetServerDMAllowed(r.Context(), guildID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "privacy_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"allowDms": allowed})
}

// PUT /guilds/:guildId/dm-toggle { "allowDms": true/false }
func (h *PrivacyHandler) SetServerDMToggle(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("guildId")

	var body struct {
		AllowDMs *bool `json:"allowDms"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.AllowDMs == nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "allowDms (boolean) required")
		return
	}

	if err := h.repo.SetServerDMAllowed(r.Context(), guildID, userID, *body.AllowDMs); err != nil {
		writeError(w, http.StatusInternalServerError, "privacy_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"allowDms": *body.AllowDMs})
}
