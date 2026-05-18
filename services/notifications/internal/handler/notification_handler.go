package handler

import (
	"encoding/json"
	"net/http"

	"github.com/decatrondev/nexe/services/notifications/internal/model"
	"github.com/decatrondev/nexe/services/notifications/internal/service"
)

type NotificationHandler struct {
	svc  *service.NotificationService
	push *service.PushService
}

func NewNotificationHandler(svc *service.NotificationService, push *service.PushService) *NotificationHandler {
	return &NotificationHandler{svc: svc, push: push}
}

func (h *NotificationHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /notifications", h.List)
	mux.HandleFunc("GET /notifications/unread-count", h.UnreadCount)
	mux.HandleFunc("POST /notifications/digest/send", h.SendDigest)
	mux.HandleFunc("POST /notifications/read-all", h.MarkAllRead)
	mux.HandleFunc("POST /notifications/{id}/read", h.MarkRead)
	mux.HandleFunc("DELETE /notifications/{id}", h.Delete)
	mux.HandleFunc("GET /notifications/preferences/{guildId}", h.GetPreference)
	mux.HandleFunc("PUT /notifications/preferences/{guildId}", h.SetPreference)

	// Web Push
	mux.HandleFunc("GET /push/vapid-key", h.GetVAPIDKey)
	mux.HandleFunc("POST /push/subscribe", h.PushSubscribe)
	mux.HandleFunc("POST /push/unsubscribe", h.PushUnsubscribe)
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

// SendDigest triggers email digest for users with unread notifications (internal/cron endpoint).
func (h *NotificationHandler) SendDigest(w http.ResponseWriter, r *http.Request) {
	sent, err := h.svc.SendDigest(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "digest_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "ok", "sent": sent})
}

// ---- Web Push ----

func (h *NotificationHandler) GetVAPIDKey(w http.ResponseWriter, r *http.Request) {
	key := ""
	if h.push != nil {
		key = h.push.GetVAPIDPublicKey()
	}
	writeJSON(w, http.StatusOK, map[string]string{"publicKey": key})
}

func (h *NotificationHandler) PushSubscribe(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing user ID")
		return
	}
	if h.push == nil {
		writeError(w, http.StatusServiceUnavailable, "push_disabled", "web push not configured")
		return
	}

	var body struct {
		Endpoint string `json:"endpoint"`
		P256dh   string `json:"p256dh"`
		Auth     string `json:"auth"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Endpoint == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "endpoint, p256dh, auth required")
		return
	}

	if err := h.push.Subscribe(r.Context(), userID, body.Endpoint, body.P256dh, body.Auth); err != nil {
		writeError(w, http.StatusInternalServerError, "push_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *NotificationHandler) PushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing user ID")
		return
	}
	if h.push == nil {
		writeError(w, http.StatusServiceUnavailable, "push_disabled", "web push not configured")
		return
	}

	var body struct {
		Endpoint string `json:"endpoint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Endpoint == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "endpoint required")
		return
	}

	if err := h.push.Unsubscribe(r.Context(), userID, body.Endpoint); err != nil {
		writeError(w, http.StatusInternalServerError, "push_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
