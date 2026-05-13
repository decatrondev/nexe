package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/decatrondev/nexe/services/messaging/internal/service"
)

type MessageHandler struct {
	svc *service.MessageService
}

func NewMessageHandler(svc *service.MessageService) *MessageHandler {
	return &MessageHandler{svc: svc}
}

func (h *MessageHandler) RegisterRoutes(mux *http.ServeMux) {
	// Channel-scoped routes
	mux.HandleFunc("GET /channels/{id}/messages", h.ListMessages)
	mux.HandleFunc("POST /channels/{id}/messages", h.SendMessage)
	mux.HandleFunc("GET /channels/{id}/pins", h.ListPins)
	mux.HandleFunc("GET /channels/{id}/search", h.SearchMessages)

	// Message-scoped routes
	mux.HandleFunc("GET /messages/{id}", h.GetMessage)
	mux.HandleFunc("PATCH /messages/{id}", h.EditMessage)
	mux.HandleFunc("DELETE /messages/{id}", h.DeleteMessage)
	mux.HandleFunc("GET /messages/{id}/edits", h.GetEditHistory)
	mux.HandleFunc("GET /messages/{id}/thread", h.ListThreadMessages)
	mux.HandleFunc("POST /messages/{id}/thread", h.SendThreadMessage)
	mux.HandleFunc("PUT /messages/{id}/pin", h.PinMessage)
	mux.HandleFunc("DELETE /messages/{id}/pin", h.UnpinMessage)

	// Reaction routes
	mux.HandleFunc("PUT /messages/{id}/reactions/{emoji}/@me", h.AddReaction)
	mux.HandleFunc("DELETE /messages/{id}/reactions/{emoji}/@me", h.RemoveReaction)
	mux.HandleFunc("GET /messages/{id}/reactions", h.GetReactions)
	mux.HandleFunc("DELETE /messages/{id}/reactions", h.RemoveAllReactions)

	// Read states
	mux.HandleFunc("POST /channels/{id}/ack", h.AckChannel)
	mux.HandleFunc("GET /users/@me/unread", h.GetUnreadChannels)
}

func getUserID(r *http.Request) string {
	return r.Header.Get("X-User-ID")
}

func requireUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	uid := getUserID(r)
	if uid == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing user ID")
		return "", false
	}
	return uid, true
}

func classifyError(w http.ResponseWriter, err error) {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "not found"):
		writeError(w, http.StatusNotFound, "NOT_FOUND", msg)
	case strings.Contains(msg, "permission"),
		strings.Contains(msg, "only the author"):
		writeError(w, http.StatusForbidden, "FORBIDDEN", msg)
	case strings.Contains(msg, "cannot be empty"):
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", msg)
	default:
		writeError(w, http.StatusInternalServerError, "INTERNAL", msg)
	}
}

// ---------------------------------------------------------------------------
// Channel-scoped handlers
// ---------------------------------------------------------------------------

func (h *MessageHandler) ListMessages(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")

	if err := h.svc.VerifyChannelAccess(r.Context(), channelID, userID); err != nil {
		writeError(w, http.StatusForbidden, "ACCESS_DENIED", "you don't have access to this channel")
		return
	}

	var before *string
	if b := r.URL.Query().Get("before"); b != "" {
		before = &b
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil {
			limit = v
		}
	}

	messages, err := h.svc.ListMessages(r.Context(), channelID, before, limit)
	if err != nil {
		classifyError(w, err)
		return
	}
	if messages == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, messages)
}

func (h *MessageHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")

	var body struct {
		Content        string  `json:"content"`
		ReplyToID      *string `json:"replyToId"`
		Type           string  `json:"type"`
		BridgeSource   *string `json:"bridgeSource"`
		BridgeAuthor   *string `json:"bridgeAuthor"`
		BridgeAuthorID *string `json:"bridgeAuthorId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	// Bridge messages have special handling
	if body.Type == "bridge" && body.BridgeSource != nil {
		msg, err := h.svc.SendBridgeMessage(r.Context(), channelID, body.Content, body.BridgeSource, body.BridgeAuthor, body.BridgeAuthorID)
		if err != nil {
			classifyError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, msg)
		return
	}

	msg, err := h.svc.SendMessage(r.Context(), channelID, userID, body.Content, body.ReplyToID)
	if err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, msg)
}

func (h *MessageHandler) ListPins(w http.ResponseWriter, r *http.Request) {
	channelID := r.PathValue("id")

	pins, err := h.svc.ListPins(r.Context(), channelID)
	if err != nil {
		classifyError(w, err)
		return
	}
	if pins == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, pins)
}

func (h *MessageHandler) SearchMessages(w http.ResponseWriter, r *http.Request) {
	channelID := r.PathValue("id")
	query := r.URL.Query().Get("q")
	if query == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "query parameter 'q' is required")
		return
	}

	limit := 25
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil {
			limit = v
		}
	}

	results, err := h.svc.SearchMessages(r.Context(), channelID, query, limit)
	if err != nil {
		classifyError(w, err)
		return
	}
	if results == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, results)
}

// ---------------------------------------------------------------------------
// Message-scoped handlers
// ---------------------------------------------------------------------------

func (h *MessageHandler) GetMessage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	msg, err := h.svc.GetMessage(r.Context(), id)
	if err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, msg)
}

func (h *MessageHandler) EditMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	messageID := r.PathValue("id")

	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	if err := h.svc.EditMessage(r.Context(), messageID, userID, body.Content); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *MessageHandler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	messageID := r.PathValue("id")

	if err := h.svc.DeleteMessage(r.Context(), messageID, userID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *MessageHandler) GetEditHistory(w http.ResponseWriter, r *http.Request) {
	messageID := r.PathValue("id")

	edits, err := h.svc.GetEditHistory(r.Context(), messageID)
	if err != nil {
		classifyError(w, err)
		return
	}
	if edits == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, edits)
}

func (h *MessageHandler) ListThreadMessages(w http.ResponseWriter, r *http.Request) {
	parentID := r.PathValue("id")
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil {
			limit = v
		}
	}
	var before *string
	if b := r.URL.Query().Get("before"); b != "" {
		before = &b
	}

	messages, err := h.svc.ListThreadMessages(r.Context(), parentID, before, limit)
	if err != nil {
		classifyError(w, err)
		return
	}
	if messages == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, messages)
}

func (h *MessageHandler) SendThreadMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	parentID := r.PathValue("id")

	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	msg, err := h.svc.SendThreadMessage(r.Context(), parentID, userID, body.Content)
	if err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, msg)
}

func (h *MessageHandler) PinMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	messageID := r.PathValue("id")

	if err := h.svc.PinMessage(r.Context(), messageID, userID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *MessageHandler) UnpinMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	messageID := r.PathValue("id")

	if err := h.svc.UnpinMessage(r.Context(), messageID, userID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Reaction handlers
// ---------------------------------------------------------------------------

func (h *MessageHandler) AddReaction(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	messageID := r.PathValue("id")
	emoji := r.PathValue("emoji")

	if err := h.svc.AddReaction(r.Context(), messageID, userID, emoji); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *MessageHandler) RemoveReaction(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	messageID := r.PathValue("id")
	emoji := r.PathValue("emoji")

	if err := h.svc.RemoveReaction(r.Context(), messageID, userID, emoji); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *MessageHandler) GetReactions(w http.ResponseWriter, r *http.Request) {
	messageID := r.PathValue("id")

	groups, err := h.svc.GetReactions(r.Context(), messageID)
	if err != nil {
		classifyError(w, err)
		return
	}
	if groups == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, groups)
}

func (h *MessageHandler) RemoveAllReactions(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUser(w, r)
	if !ok {
		return
	}
	messageID := r.PathValue("id")

	if err := h.svc.RemoveAllReactions(r.Context(), messageID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// AckChannel marks a channel as read up to the latest message.
func (h *MessageHandler) AckChannel(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")

	var body struct {
		MessageID string `json:"messageId"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	if err := h.svc.AckChannel(r.Context(), userID, channelID, body.MessageID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetUnreadChannels returns channels with unread messages for the user.
func (h *MessageHandler) GetUnreadChannels(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	unreads, err := h.svc.GetUnreadChannels(r.Context(), userID)
	if err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, unreads)
}
