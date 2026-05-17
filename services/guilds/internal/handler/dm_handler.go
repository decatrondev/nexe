package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/decatrondev/nexe/services/guilds/internal/repository"
	"github.com/redis/go-redis/v9"
)

const (
	EventDMChannelCreate = "DM_CHANNEL_CREATE"
	EventDMMessageCreate = "DM_MESSAGE_CREATE"
	EventDMMessageUpdate = "DM_MESSAGE_UPDATE"
	EventDMMessageDelete = "DM_MESSAGE_DELETE"
	EventDMTypingStart   = "DM_TYPING_START"
)

type DMHandler struct {
	repo    *repository.DMRepository
	privacy *repository.PrivacyRepository
	rdb     *redis.Client
}

func NewDMHandler(repo *repository.DMRepository, privacy *repository.PrivacyRepository, rdb *redis.Client) *DMHandler {
	return &DMHandler{repo: repo, privacy: privacy, rdb: rdb}
}

func (h *DMHandler) RegisterRoutes(mux *http.ServeMux) {
	// DM Channels
	mux.HandleFunc("POST /dm-channels", h.CreateDM)
	mux.HandleFunc("GET /dm-channels", h.ListDMs)
	mux.HandleFunc("GET /dm-channels/{id}", h.GetDM)
	mux.HandleFunc("PATCH /dm-channels/{id}", h.UpdateDM)
	mux.HandleFunc("DELETE /dm-channels/{id}", h.CloseDM)
	mux.HandleFunc("PUT /dm-channels/{id}/members/{userId}", h.AddParticipant)
	mux.HandleFunc("DELETE /dm-channels/{id}/members/{userId}", h.RemoveParticipant)
	mux.HandleFunc("DELETE /dm-channels/{id}/members/@me", h.LeaveGroupDM)

	// DM Requests
	mux.HandleFunc("GET /dm-requests", h.ListRequests)
	mux.HandleFunc("POST /dm-requests/{id}/accept", h.AcceptRequest)
	mux.HandleFunc("POST /dm-requests/{id}/reject", h.RejectRequest)

	// DM Messages
	mux.HandleFunc("GET /dm-channels/{id}/messages", h.GetMessages)
	mux.HandleFunc("POST /dm-channels/{id}/messages", h.SendMessage)
	mux.HandleFunc("PATCH /dm-messages/{id}", h.EditMessage)
	mux.HandleFunc("DELETE /dm-messages/{id}", h.DeleteMessage)

	// Typing
	mux.HandleFunc("POST /dm-channels/{id}/typing", h.Typing)
}

// publishToParticipants sends an event to all participants of a DM channel.
func (h *DMHandler) publishToParticipants(ctx context.Context, channelID, eventType string, data interface{}, excludeUserID string) {
	ids, err := h.repo.GetParticipantIDs(ctx, channelID)
	if err != nil {
		return
	}

	event := struct {
		Type string      `json:"type"`
		Data interface{} `json:"data"`
	}{Type: eventType, Data: data}

	payload, err := json.Marshal(event)
	if err != nil {
		return
	}

	for _, uid := range ids {
		if uid == excludeUserID {
			continue
		}
		channel := fmt.Sprintf("nexe:notifications:user:%s", uid)
		if err := h.rdb.Publish(ctx, channel, payload).Err(); err != nil {
			slog.Error("failed to publish DM event", "error", err, "user", uid)
		}
	}
}

// publishToSelf sends an event to the user themselves (for multi-device sync).
func (h *DMHandler) publishToSelf(ctx context.Context, userID, eventType string, data interface{}) {
	event := struct {
		Type string      `json:"type"`
		Data interface{} `json:"data"`
	}{Type: eventType, Data: data}

	payload, err := json.Marshal(event)
	if err != nil {
		return
	}

	channel := fmt.Sprintf("nexe:notifications:user:%s", userID)
	h.rdb.Publish(ctx, channel, payload)
}

// ---- DM Channel endpoints ----

// CreateDM creates or retrieves a 1-on-1 DM channel.
// POST /dm-channels { "targetId": "..." } or { "type": "group_dm", "name": "...", "userIds": [...] }
func (h *DMHandler) CreateDM(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	var body struct {
		TargetID string   `json:"targetId"`
		Type     string   `json:"type"`
		Name     string   `json:"name"`
		UserIDs  []string `json:"userIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	if body.Type == "group_dm" {
		if len(body.UserIDs) < 1 || len(body.UserIDs) > 9 {
			writeError(w, http.StatusBadRequest, "invalid_users", "group DMs require 1-9 other users")
			return
		}
		ch, err := h.repo.CreateGroupDM(r.Context(), userID, body.Name, body.UserIDs)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
			return
		}
		// Notify all participants
		for _, uid := range body.UserIDs {
			h.publishToSelf(r.Context(), uid, EventDMChannelCreate, ch)
		}
		writeJSON(w, http.StatusCreated, ch)
		return
	}

	// 1-on-1 DM
	if body.TargetID == "" {
		writeError(w, http.StatusBadRequest, "missing_target", "targetId required")
		return
	}
	if body.TargetID == userID {
		writeError(w, http.StatusBadRequest, "self_dm", "cannot DM yourself")
		return
	}

	// Check privacy: can this user DM the target?
	if h.privacy != nil {
		canDM, _ := h.privacy.CanSendDM(r.Context(), userID, body.TargetID)
		if !canDM {
			writeError(w, http.StatusForbidden, "privacy", "this user is not accepting DMs from you")
			return
		}
	}

	ch, err := h.repo.GetOrCreateDM(r.Context(), userID, body.TargetID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
		return
	}

	// Check if they are friends or share a guild
	related, _ := h.repo.AreFriendsOrShareGuild(r.Context(), userID, body.TargetID)
	if !related {
		// Mark the target's participation as a request
		h.repo.SetIsRequest(r.Context(), ch.ID, body.TargetID, true)
		// Re-fetch to include updated is_request
		ch, _ = h.repo.GetByID(r.Context(), ch.ID)
	}

	writeJSON(w, http.StatusOK, ch)
}

// ListDMs returns the user's open DM channels.
// GET /dm-channels
func (h *DMHandler) ListDMs(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	channels, err := h.repo.ListForUser(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
		return
	}
	if channels == nil {
		channels = []repository.DMChannel{}
	}
	writeJSON(w, http.StatusOK, channels)
}

// GetDM returns a specific DM channel.
// GET /dm-channels/:id
func (h *DMHandler) GetDM(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")

	ok, _ = h.repo.IsParticipant(r.Context(), channelID, userID)
	if !ok {
		writeError(w, http.StatusForbidden, "forbidden", "not a participant")
		return
	}

	ch, err := h.repo.GetByID(r.Context(), channelID)
	if err != nil || ch == nil {
		writeError(w, http.StatusNotFound, "not_found", "DM not found")
		return
	}
	writeJSON(w, http.StatusOK, ch)
}

// CloseDM hides a DM from the user's list.
// DELETE /dm-channels/:id
func (h *DMHandler) CloseDM(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")

	if err := h.repo.CloseDM(r.Context(), channelID, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- DM Message endpoints ----

// GetMessages returns messages for a DM channel.
// GET /dm-channels/:id/messages?limit=50&before=uuid
func (h *DMHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")

	ok, _ = h.repo.IsParticipant(r.Context(), channelID, userID)
	if !ok {
		writeError(w, http.StatusForbidden, "forbidden", "not a participant")
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	before := r.URL.Query().Get("before")

	messages, err := h.repo.GetMessages(r.Context(), channelID, limit, before)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
		return
	}
	if messages == nil {
		messages = []repository.DMMessage{}
	}
	writeJSON(w, http.StatusOK, messages)
}

// SendMessage sends a message to a DM channel.
// POST /dm-channels/:id/messages { "content": "..." }
func (h *DMHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")

	ok, _ = h.repo.IsParticipant(r.Context(), channelID, userID)
	if !ok {
		writeError(w, http.StatusForbidden, "forbidden", "not a participant")
		return
	}

	var body struct {
		Content   string  `json:"content"`
		ReplyToID *string `json:"replyToId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}
	if body.Content == "" {
		writeError(w, http.StatusBadRequest, "empty_content", "message content required")
		return
	}
	if len(body.Content) > 2000 {
		writeError(w, http.StatusBadRequest, "too_long", "message exceeds 2000 characters")
		return
	}

	msg := &repository.DMMessage{
		ChannelID: channelID,
		AuthorID:  userID,
		Content:   body.Content,
		Type:      "default",
		ReplyToID: body.ReplyToID,
		Embeds:    []byte("[]"),
		Attachments: []byte("[]"),
	}

	if err := h.repo.CreateMessage(r.Context(), msg); err != nil {
		writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
		return
	}

	// Update channel timestamp for sorting
	h.repo.TouchChannel(r.Context(), channelID)

	// Reopen DM for all participants who had it closed
	ids, _ := h.repo.GetParticipantIDs(r.Context(), channelID)
	for _, uid := range ids {
		if uid != userID {
			h.repo.ReopenDM(r.Context(), channelID, uid)
		}
	}

	// Broadcast to other participants (sender already has msg from API response)
	h.publishToParticipants(r.Context(), channelID, EventDMMessageCreate, msg, userID)

	writeJSON(w, http.StatusCreated, msg)
}

// EditMessage edits a DM message.
// PATCH /dm-messages/:id { "content": "..." }
func (h *DMHandler) EditMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	msgID := r.PathValue("id")

	msg, err := h.repo.GetMessageByID(r.Context(), msgID)
	if err != nil || msg == nil {
		writeError(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	if msg.AuthorID != userID {
		writeError(w, http.StatusForbidden, "forbidden", "can only edit your own messages")
		return
	}

	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Content == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "content required")
		return
	}

	if err := h.repo.EditMessage(r.Context(), msgID, body.Content); err != nil {
		writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
		return
	}

	updated, _ := h.repo.GetMessageByID(r.Context(), msgID)
	h.publishToParticipants(r.Context(), msg.ChannelID, EventDMMessageUpdate, updated, userID)
	writeJSON(w, http.StatusOK, updated)
}

// DeleteMessage soft-deletes a DM message.
// DELETE /dm-messages/:id
func (h *DMHandler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	msgID := r.PathValue("id")

	msg, err := h.repo.GetMessageByID(r.Context(), msgID)
	if err != nil || msg == nil {
		writeError(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	if msg.AuthorID != userID {
		writeError(w, http.StatusForbidden, "forbidden", "can only delete your own messages")
		return
	}

	if err := h.repo.DeleteMessage(r.Context(), msgID); err != nil {
		writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
		return
	}

	h.publishToParticipants(r.Context(), msg.ChannelID, EventDMMessageDelete,
		map[string]string{"id": msgID, "channelId": msg.ChannelID}, userID)
	w.WriteHeader(http.StatusNoContent)
}

// Typing broadcasts a typing indicator to DM participants.
// POST /dm-channels/:id/typing
func (h *DMHandler) Typing(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")

	ok, _ = h.repo.IsParticipant(r.Context(), channelID, userID)
	if !ok {
		writeError(w, http.StatusForbidden, "forbidden", "not a participant")
		return
	}

	h.publishToParticipants(r.Context(), channelID, EventDMTypingStart,
		map[string]string{"channelId": channelID, "userId": userID}, userID)
	w.WriteHeader(http.StatusNoContent)
}

// UpdateDM updates a group DM's name or icon.
// PATCH /dm-channels/:id { "name": "...", "iconUrl": "..." }
func (h *DMHandler) UpdateDM(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")

	ch, err := h.repo.GetByID(r.Context(), channelID)
	if err != nil || ch == nil {
		writeError(w, http.StatusNotFound, "not_found", "channel not found")
		return
	}
	if ch.Type != "group_dm" {
		writeError(w, http.StatusBadRequest, "not_group", "can only update group DMs")
		return
	}
	if ch.OwnerID == nil || *ch.OwnerID != userID {
		writeError(w, http.StatusForbidden, "forbidden", "only the owner can update")
		return
	}

	var body struct {
		Name    *string `json:"name"`
		IconURL *string `json:"iconUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	if err := h.repo.UpdateChannel(r.Context(), channelID, body.Name, body.IconURL); err != nil {
		writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
		return
	}

	updated, _ := h.repo.GetByID(r.Context(), channelID)
	h.publishToParticipants(r.Context(), channelID, EventDMChannelCreate, updated, "")
	writeJSON(w, http.StatusOK, updated)
}

// AddParticipant adds a user to a group DM.
// PUT /dm-channels/:id/members/:userId
func (h *DMHandler) AddParticipant(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")
	targetID := r.PathValue("userId")

	ch, err := h.repo.GetByID(r.Context(), channelID)
	if err != nil || ch == nil {
		writeError(w, http.StatusNotFound, "not_found", "channel not found")
		return
	}
	if ch.Type != "group_dm" {
		writeError(w, http.StatusBadRequest, "not_group", "can only add members to group DMs")
		return
	}
	if ch.OwnerID == nil || *ch.OwnerID != userID {
		writeError(w, http.StatusForbidden, "forbidden", "only the owner can add members")
		return
	}

	count, _ := h.repo.ParticipantCount(r.Context(), channelID)
	if count >= 10 {
		writeError(w, http.StatusBadRequest, "limit", "group DM max 10 participants")
		return
	}

	if err := h.repo.AddParticipant(r.Context(), channelID, targetID); err != nil {
		writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
		return
	}

	updated, _ := h.repo.GetByID(r.Context(), channelID)
	// Notify all including the new member
	h.publishToParticipants(r.Context(), channelID, EventDMChannelCreate, updated, "")
	h.publishToSelf(r.Context(), targetID, EventDMChannelCreate, updated)
	writeJSON(w, http.StatusOK, updated)
}

// RemoveParticipant removes a user from a group DM (owner only).
// DELETE /dm-channels/:id/members/:userId
func (h *DMHandler) RemoveParticipant(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")
	targetID := r.PathValue("userId")

	ch, err := h.repo.GetByID(r.Context(), channelID)
	if err != nil || ch == nil {
		writeError(w, http.StatusNotFound, "not_found", "channel not found")
		return
	}
	if ch.Type != "group_dm" {
		writeError(w, http.StatusBadRequest, "not_group", "can only remove from group DMs")
		return
	}
	if ch.OwnerID == nil || *ch.OwnerID != userID {
		writeError(w, http.StatusForbidden, "forbidden", "only the owner can remove members")
		return
	}
	if targetID == userID {
		writeError(w, http.StatusBadRequest, "self_remove", "use leave instead")
		return
	}

	if err := h.repo.RemoveParticipant(r.Context(), channelID, targetID); err != nil {
		writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
		return
	}

	updated, _ := h.repo.GetByID(r.Context(), channelID)
	h.publishToParticipants(r.Context(), channelID, EventDMChannelCreate, updated, "")
	w.WriteHeader(http.StatusNoContent)
}

// LeaveGroupDM removes yourself from a group DM.
// DELETE /dm-channels/:id/members/@me
func (h *DMHandler) LeaveGroupDM(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")

	ch, err := h.repo.GetByID(r.Context(), channelID)
	if err != nil || ch == nil {
		writeError(w, http.StatusNotFound, "not_found", "channel not found")
		return
	}
	if ch.Type != "group_dm" {
		writeError(w, http.StatusBadRequest, "not_group", "can only leave group DMs")
		return
	}

	if err := h.repo.RemoveParticipant(r.Context(), channelID, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
		return
	}

	updated, _ := h.repo.GetByID(r.Context(), channelID)
	h.publishToParticipants(r.Context(), channelID, EventDMChannelCreate, updated, "")
	w.WriteHeader(http.StatusNoContent)
}

// ---- DM Requests ----

// ListRequests returns DMs that are marked as requests for this user.
// GET /dm-requests
func (h *DMHandler) ListRequests(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	channels, err := h.repo.ListRequestsForUser(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
		return
	}
	if channels == nil {
		channels = []repository.DMChannel{}
	}
	writeJSON(w, http.StatusOK, channels)
}

// AcceptRequest accepts a DM request — moves it from requests to regular DMs.
// POST /dm-requests/:id/accept
func (h *DMHandler) AcceptRequest(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")

	isP, _ := h.repo.IsParticipant(r.Context(), channelID, userID)
	if !isP {
		writeError(w, http.StatusForbidden, "forbidden", "not a participant")
		return
	}

	if err := h.repo.SetIsRequest(r.Context(), channelID, userID, false); err != nil {
		writeError(w, http.StatusInternalServerError, "dm_error", err.Error())
		return
	}

	ch, _ := h.repo.GetByID(r.Context(), channelID)
	h.publishToSelf(r.Context(), userID, EventDMChannelCreate, ch)
	writeJSON(w, http.StatusOK, ch)
}

// RejectRequest rejects a DM request — closes the DM.
// POST /dm-requests/:id/reject
func (h *DMHandler) RejectRequest(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")

	isP, _ := h.repo.IsParticipant(r.Context(), channelID, userID)
	if !isP {
		writeError(w, http.StatusForbidden, "forbidden", "not a participant")
		return
	}

	h.repo.CloseDM(r.Context(), channelID, userID)
	w.WriteHeader(http.StatusNoContent)
}
