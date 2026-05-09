package handler

import (
	"encoding/json"
	"net/http"

	"github.com/decatrondev/nexe/services/presence/internal/model"
	"github.com/decatrondev/nexe/services/presence/internal/service"
)

type PresenceHandler struct {
	svc *service.PresenceService
}

func NewPresenceHandler(svc *service.PresenceService) *PresenceHandler {
	return &PresenceHandler{svc: svc}
}

func (h *PresenceHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /users/{id}/presence", h.GetPresence)
	mux.HandleFunc("PATCH /users/@me/presence", h.UpdatePresence)
	mux.HandleFunc("PATCH /users/@me/status", h.UpdateCustomStatus)
	mux.HandleFunc("POST /users/@me/heartbeat", h.Heartbeat)
	mux.HandleFunc("POST /users/@me/offline", h.SetOffline)
	mux.HandleFunc("POST /users/{id}/stream-status", h.SetStreamStatus)
	mux.HandleFunc("GET /guilds/{id}/online", h.GetGuildOnline)
	mux.HandleFunc("POST /guilds/{id}/track", h.TrackGuildOnline)
	mux.HandleFunc("POST /guilds/{id}/untrack", h.UntrackGuildOnline)
	mux.HandleFunc("POST /users/bulk-presence", h.GetBulkPresence)
}

func (h *PresenceHandler) GetPresence(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")

	presence, err := h.svc.GetPresence(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "presence_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, presence)
}

func (h *PresenceHandler) UpdatePresence(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing X-User-ID")
		return
	}

	var update model.StatusUpdate
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	if err := h.svc.SetPresence(r.Context(), userID, update); err != nil {
		writeError(w, http.StatusBadRequest, "presence_error", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *PresenceHandler) UpdateCustomStatus(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing X-User-ID")
		return
	}

	var body struct {
		CustomText  string `json:"customText"`
		CustomEmoji string `json:"customEmoji"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	// Get current status first
	current, err := h.svc.GetPresence(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "presence_error", err.Error())
		return
	}

	status := current.Status
	if status == "offline" {
		status = "online"
	}

	if err := h.svc.SetPresence(r.Context(), userID, model.StatusUpdate{
		Status:      status,
		CustomText:  body.CustomText,
		CustomEmoji: body.CustomEmoji,
	}); err != nil {
		writeError(w, http.StatusBadRequest, "status_error", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *PresenceHandler) Heartbeat(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing X-User-ID")
		return
	}

	if err := h.svc.Heartbeat(r.Context(), userID); err != nil {
		writeError(w, http.StatusInternalServerError, "heartbeat_error", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *PresenceHandler) SetOffline(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing X-User-ID")
		return
	}

	if err := h.svc.SetOffline(r.Context(), userID); err != nil {
		writeError(w, http.StatusInternalServerError, "offline_error", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *PresenceHandler) SetStreamStatus(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")

	var stream model.StreamStatus
	if err := json.NewDecoder(r.Body).Decode(&stream); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	if err := h.svc.SetStreamStatus(r.Context(), userID, stream); err != nil {
		writeError(w, http.StatusInternalServerError, "stream_error", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *PresenceHandler) GetGuildOnline(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")

	presences, err := h.svc.GetGuildOnlinePresences(r.Context(), guildID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "online_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, presences)
}

func (h *PresenceHandler) TrackGuildOnline(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")

	var body struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "userId is required")
		return
	}

	if err := h.svc.TrackGuildOnline(r.Context(), guildID, body.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "track_error", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *PresenceHandler) UntrackGuildOnline(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")

	var body struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "userId is required")
		return
	}

	if err := h.svc.UntrackGuildOnline(r.Context(), guildID, body.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "untrack_error", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *PresenceHandler) GetBulkPresence(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserIDs []string `json:"userIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.UserIDs) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_body", "userIds array is required")
		return
	}

	if len(body.UserIDs) > 100 {
		writeError(w, http.StatusBadRequest, "too_many", "max 100 users per request")
		return
	}

	presences, err := h.svc.GetBulkPresence(r.Context(), body.UserIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "bulk_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, presences)
}

