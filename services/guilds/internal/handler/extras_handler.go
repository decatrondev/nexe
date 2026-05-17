package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

type ExtrasHandler struct {
	db  *sql.DB
	rdb *redis.Client
}

func NewExtrasHandler(db *sql.DB, rdb *redis.Client) *ExtrasHandler {
	return &ExtrasHandler{db: db, rdb: rdb}
}

func (h *ExtrasHandler) RegisterRoutes(mux *http.ServeMux) {
	// Friend Categories
	mux.HandleFunc("GET /friend-categories", h.ListCategories)
	mux.HandleFunc("POST /friend-categories", h.CreateCategory)
	mux.HandleFunc("PATCH /friend-categories/{id}", h.UpdateCategory)
	mux.HandleFunc("DELETE /friend-categories/{id}", h.DeleteCategory)
	mux.HandleFunc("PUT /friend-categories/{id}/members/{userId}", h.AddToCategory)
	mux.HandleFunc("DELETE /friend-categories/{id}/members/{userId}", h.RemoveFromCategory)

	// Scheduled Messages
	mux.HandleFunc("GET /dm-channels/{id}/scheduled", h.ListScheduled)
	mux.HandleFunc("POST /dm-channels/{id}/scheduled", h.CreateScheduled)
	mux.HandleFunc("DELETE /dm-scheduled/{id}", h.DeleteScheduled)

	// Reminders
	mux.HandleFunc("GET /dm-reminders", h.ListReminders)
	mux.HandleFunc("POST /dm-reminders", h.CreateReminder)
	mux.HandleFunc("DELETE /dm-reminders/{id}", h.DeleteReminder)
}

// ---- Friend Categories ----

type FriendCategory struct {
	ID       string   `json:"id"`
	UserID   string   `json:"userId"`
	Name     string   `json:"name"`
	Color    *string  `json:"color,omitempty"`
	Position int      `json:"position"`
	Members  []string `json:"members"`
}

func (h *ExtrasHandler) ListCategories(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	rows, err := h.db.QueryContext(r.Context(),
		`SELECT id, name, color, position FROM friend_categories WHERE user_id = $1 ORDER BY position`, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error", err.Error())
		return
	}
	defer rows.Close()

	var cats []FriendCategory
	for rows.Next() {
		var c FriendCategory
		c.UserID = userID
		if err := rows.Scan(&c.ID, &c.Name, &c.Color, &c.Position); err != nil {
			continue
		}
		// Load members
		mRows, _ := h.db.QueryContext(r.Context(),
			`SELECT friend_user_id FROM friend_category_members WHERE category_id = $1`, c.ID)
		if mRows != nil {
			for mRows.Next() {
				var mid string
				if mRows.Scan(&mid) == nil {
					c.Members = append(c.Members, mid)
				}
			}
			mRows.Close()
		}
		if c.Members == nil {
			c.Members = []string{}
		}
		cats = append(cats, c)
	}
	if cats == nil {
		cats = []FriendCategory{}
	}
	writeJSON(w, http.StatusOK, cats)
}

func (h *ExtrasHandler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Name  string  `json:"name"`
		Color *string `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "name required")
		return
	}

	var id string
	err := h.db.QueryRowContext(r.Context(),
		`INSERT INTO friend_categories (user_id, name, color) VALUES ($1, $2, $3) RETURNING id`,
		userID, body.Name, body.Color,
	).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, FriendCategory{ID: id, UserID: userID, Name: body.Name, Color: body.Color, Members: []string{}})
}

func (h *ExtrasHandler) UpdateCategory(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	var body struct {
		Name  *string `json:"name"`
		Color *string `json:"color"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	if body.Name != nil {
		h.db.ExecContext(r.Context(), `UPDATE friend_categories SET name = $1 WHERE id = $2 AND user_id = $3`, *body.Name, id, userID)
	}
	if body.Color != nil {
		h.db.ExecContext(r.Context(), `UPDATE friend_categories SET color = $1 WHERE id = $2 AND user_id = $3`, *body.Color, id, userID)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ExtrasHandler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	h.db.ExecContext(r.Context(), `DELETE FROM friend_categories WHERE id = $1 AND user_id = $2`, r.PathValue("id"), userID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *ExtrasHandler) AddToCategory(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	catID := r.PathValue("id")
	friendID := r.PathValue("userId")
	// Verify ownership
	var ownerID string
	h.db.QueryRowContext(r.Context(), `SELECT user_id FROM friend_categories WHERE id = $1`, catID).Scan(&ownerID)
	if ownerID != userID {
		writeError(w, http.StatusForbidden, "forbidden", "not your category")
		return
	}
	h.db.ExecContext(r.Context(),
		`INSERT INTO friend_category_members (category_id, friend_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, catID, friendID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *ExtrasHandler) RemoveFromCategory(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	catID := r.PathValue("id")
	friendID := r.PathValue("userId")
	var ownerID string
	h.db.QueryRowContext(r.Context(), `SELECT user_id FROM friend_categories WHERE id = $1`, catID).Scan(&ownerID)
	if ownerID != userID {
		writeError(w, http.StatusForbidden, "forbidden", "not your category")
		return
	}
	h.db.ExecContext(r.Context(), `DELETE FROM friend_category_members WHERE category_id = $1 AND friend_user_id = $2`, catID, friendID)
	w.WriteHeader(http.StatusNoContent)
}

// ---- Scheduled Messages ----

type ScheduledMessage struct {
	ID        string    `json:"id"`
	ChannelID string    `json:"channelId"`
	AuthorID  string    `json:"authorId"`
	Content   string    `json:"content"`
	SendAt    time.Time `json:"sendAt"`
	Sent      bool      `json:"sent"`
	CreatedAt time.Time `json:"createdAt"`
}

func (h *ExtrasHandler) ListScheduled(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")
	rows, err := h.db.QueryContext(r.Context(),
		`SELECT id, channel_id, author_id, content, send_at, sent, created_at
		 FROM dm_scheduled_messages WHERE channel_id = $1 AND author_id = $2 AND sent = false
		 ORDER BY send_at`, channelID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error", err.Error())
		return
	}
	defer rows.Close()
	var msgs []ScheduledMessage
	for rows.Next() {
		var m ScheduledMessage
		rows.Scan(&m.ID, &m.ChannelID, &m.AuthorID, &m.Content, &m.SendAt, &m.Sent, &m.CreatedAt)
		msgs = append(msgs, m)
	}
	if msgs == nil {
		msgs = []ScheduledMessage{}
	}
	writeJSON(w, http.StatusOK, msgs)
}

func (h *ExtrasHandler) CreateScheduled(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")
	var body struct {
		Content string `json:"content"`
		SendAt  string `json:"sendAt"` // ISO 8601
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Content == "" || body.SendAt == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "content and sendAt required")
		return
	}
	sendAt, err := time.Parse(time.RFC3339, body.SendAt)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_date", "sendAt must be RFC3339")
		return
	}
	if sendAt.Before(time.Now()) {
		writeError(w, http.StatusBadRequest, "past_date", "sendAt must be in the future")
		return
	}

	var id string
	err = h.db.QueryRowContext(r.Context(),
		`INSERT INTO dm_scheduled_messages (channel_id, author_id, content, send_at) VALUES ($1, $2, $3, $4) RETURNING id`,
		channelID, userID, body.Content, sendAt,
	).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, ScheduledMessage{ID: id, ChannelID: channelID, AuthorID: userID, Content: body.Content, SendAt: sendAt})
}

func (h *ExtrasHandler) DeleteScheduled(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	h.db.ExecContext(r.Context(), `DELETE FROM dm_scheduled_messages WHERE id = $1 AND author_id = $2`, r.PathValue("id"), userID)
	w.WriteHeader(http.StatusNoContent)
}

// ---- Reminders ----

type Reminder struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	ChannelID string    `json:"channelId"`
	MessageID string    `json:"messageId"`
	RemindAt  time.Time `json:"remindAt"`
	Fired     bool      `json:"fired"`
	CreatedAt time.Time `json:"createdAt"`
}

func (h *ExtrasHandler) ListReminders(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	rows, err := h.db.QueryContext(r.Context(),
		`SELECT id, channel_id, message_id, remind_at, fired, created_at
		 FROM dm_reminders WHERE user_id = $1 AND fired = false ORDER BY remind_at`, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error", err.Error())
		return
	}
	defer rows.Close()
	var reminders []Reminder
	for rows.Next() {
		var rem Reminder
		rem.UserID = userID
		rows.Scan(&rem.ID, &rem.ChannelID, &rem.MessageID, &rem.RemindAt, &rem.Fired, &rem.CreatedAt)
		reminders = append(reminders, rem)
	}
	if reminders == nil {
		reminders = []Reminder{}
	}
	writeJSON(w, http.StatusOK, reminders)
}

func (h *ExtrasHandler) CreateReminder(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	var body struct {
		ChannelID string `json:"channelId"`
		MessageID string `json:"messageId"`
		RemindAt  string `json:"remindAt"` // ISO 8601
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ChannelID == "" || body.MessageID == "" || body.RemindAt == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "channelId, messageId, remindAt required")
		return
	}
	remindAt, err := time.Parse(time.RFC3339, body.RemindAt)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_date", "remindAt must be RFC3339")
		return
	}

	var id string
	err = h.db.QueryRowContext(r.Context(),
		`INSERT INTO dm_reminders (user_id, channel_id, message_id, remind_at) VALUES ($1, $2, $3, $4) RETURNING id`,
		userID, body.ChannelID, body.MessageID, remindAt,
	).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, Reminder{ID: id, UserID: userID, ChannelID: body.ChannelID, MessageID: body.MessageID, RemindAt: remindAt})
}

func (h *ExtrasHandler) DeleteReminder(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	h.db.ExecContext(r.Context(), `DELETE FROM dm_reminders WHERE id = $1 AND user_id = $2`, r.PathValue("id"), userID)
	w.WriteHeader(http.StatusNoContent)
}

// StartScheduledMessageWorker runs a background job to send scheduled messages.
func (h *ExtrasHandler) StartScheduledMessageWorker(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.processScheduledMessages(ctx)
			h.processReminders(ctx)
		}
	}
}

func (h *ExtrasHandler) processScheduledMessages(ctx context.Context) {
	rows, err := h.db.QueryContext(ctx,
		`SELECT id, channel_id, author_id, content FROM dm_scheduled_messages WHERE sent = false AND send_at <= NOW()`)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, channelID, authorID, content string
		if rows.Scan(&id, &channelID, &authorID, &content) != nil {
			continue
		}
		// Create the message
		var msgID string
		err := h.db.QueryRowContext(ctx,
			`INSERT INTO dm_messages (channel_id, author_id, content, type, embeds, attachments)
			 VALUES ($1, $2, $3, 'default', '[]', '[]') RETURNING id`,
			channelID, authorID, content,
		).Scan(&msgID)
		if err != nil {
			slog.Error("failed to send scheduled message", "error", err, "id", id)
			continue
		}
		// Mark as sent
		h.db.ExecContext(ctx, `UPDATE dm_scheduled_messages SET sent = true WHERE id = $1`, id)
		// Update channel timestamp
		h.db.ExecContext(ctx, `UPDATE dm_channels SET updated_at = NOW() WHERE id = $1`, channelID)

		// Publish DM_MESSAGE_CREATE to participants
		h.publishScheduledMessage(ctx, channelID, msgID, authorID, content)

		slog.Info("sent scheduled message", "id", id, "channel", channelID)
	}
}

func (h *ExtrasHandler) processReminders(ctx context.Context) {
	rows, err := h.db.QueryContext(ctx,
		`SELECT id, user_id, channel_id, message_id FROM dm_reminders WHERE fired = false AND remind_at <= NOW()`)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, userID, channelID, messageID string
		if rows.Scan(&id, &userID, &channelID, &messageID) != nil {
			continue
		}
		// Send notification to user
		event := struct {
			Type string      `json:"type"`
			Data interface{} `json:"data"`
		}{
			Type: "DM_REMINDER",
			Data: map[string]string{"channelId": channelID, "messageId": messageID},
		}
		payload, _ := json.Marshal(event)
		channel := fmt.Sprintf("nexe:notifications:user:%s", userID)
		h.rdb.Publish(ctx, channel, payload)

		// Mark as fired
		h.db.ExecContext(ctx, `UPDATE dm_reminders SET fired = true WHERE id = $1`, id)
		slog.Info("fired reminder", "id", id, "user", userID)
	}
}

func (h *ExtrasHandler) publishScheduledMessage(ctx context.Context, channelID, msgID, authorID, content string) {
	// Get participants
	rows, err := h.db.QueryContext(ctx, `SELECT user_id FROM dm_participants WHERE channel_id = $1`, channelID)
	if err != nil {
		return
	}
	defer rows.Close()

	msg := map[string]interface{}{
		"id":        msgID,
		"channelId": channelID,
		"authorId":  authorID,
		"content":   content,
		"type":      "default",
		"createdAt": time.Now().Format(time.RFC3339),
	}
	event := struct {
		Type string      `json:"type"`
		Data interface{} `json:"data"`
	}{Type: "DM_MESSAGE_CREATE", Data: msg}
	payload, _ := json.Marshal(event)

	for rows.Next() {
		var uid string
		if rows.Scan(&uid) != nil {
			continue
		}
		channel := fmt.Sprintf("nexe:notifications:user:%s", uid)
		h.rdb.Publish(ctx, channel, payload)
	}
}
