package handler

import (
	"encoding/json"
	"net/http"

	"github.com/decatrondev/nexe/services/notifications/internal/model"
	"github.com/decatrondev/nexe/services/notifications/internal/service"
)

type NotificationHandler struct {
	svc *service.NotificationService
}

func NewNotificationHandler(svc *service.NotificationService) *NotificationHandler {
	return &NotificationHandler{svc: svc}
}

func (h *NotificationHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /notifications", h.List)
	mux.HandleFunc("GET /notifications/unread-count", h.UnreadCount)
	mux.HandleFunc("POST /notifications/{id}/read", h.MarkRead)
	mux.HandleFunc("POST /notifications/read-all", h.MarkAllRead)
	mux.HandleFunc("DELETE /notifications/{id}", h.Delete)
	mux.HandleFunc("GET /notifications/preferences/{guildId}", h.GetPreference)
	mux.HandleFunc("PUT /notifications/preferences/{guildId}", h.SetPreference)
}

func (h *NotificationHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing user ID")
		return
	}

	unreadOnly := r.URL.Query().Get("unread") == "true"
	notifications, err := h.svc.GetNotifications(r.Context(), userID, 50, unreadOnly)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch_failed", err.Error())
		return
	}

	if notifications == nil {
		notifications = []model.Notification{}
	}
	writeJSON(w, http.StatusOK, notifications)
}

func (h *NotificationHandler) UnreadCount(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing user ID")
		return
	}

	count, err := h.svc.CountUnread(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "count_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]int{"count": count})
}

func (h *NotificationHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	notifID := r.PathValue("id")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing user ID")
		return
	}

	if err := h.svc.MarkRead(r.Context(), userID, notifID); err != nil {
		writeError(w, http.StatusBadRequest, "mark_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *NotificationHandler) MarkAllRead(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing user ID")
		return
	}

	if err := h.svc.MarkAllRead(r.Context(), userID); err != nil {
		writeError(w, http.StatusInternalServerError, "mark_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *NotificationHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	notifID := r.PathValue("id")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing user ID")
		return
	}

	if err := h.svc.DeleteNotification(r.Context(), userID, notifID); err != nil {
		writeError(w, http.StatusBadRequest, "delete_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *NotificationHandler) GetPreference(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	guildID := r.PathValue("guildId")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing user ID")
		return
	}

	pref, err := h.svc.GetPreference(r.Context(), userID, guildID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, pref)
}

func (h *NotificationHandler) SetPreference(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	guildID := r.PathValue("guildId")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing user ID")
		return
	}

	var body struct {
		Level     string  `json:"level"`
		ChannelID *string `json:"channelId,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	pref := &model.NotificationPreference{
		UserID:    userID,
		GuildID:   guildID,
		ChannelID: body.ChannelID,
		Level:     body.Level,
	}

	if err := h.svc.SetPreference(r.Context(), pref); err != nil {
		writeError(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, pref)
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": code, "message": message})
}
