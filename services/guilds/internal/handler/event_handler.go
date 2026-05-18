package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

type EventHandler struct {
	db  *sql.DB
	rdb *redis.Client
}

func NewEventHandler(db *sql.DB, rdb *redis.Client) *EventHandler {
	return &EventHandler{db: db, rdb: rdb}
}

func (h *EventHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /guilds/{id}/events", h.ListEvents)
	mux.HandleFunc("POST /guilds/{id}/events", h.CreateEvent)
	mux.HandleFunc("GET /events/{id}", h.GetEvent)
	mux.HandleFunc("PATCH /events/{id}", h.UpdateEvent)
	mux.HandleFunc("DELETE /events/{id}", h.DeleteEvent)
	mux.HandleFunc("PUT /events/{id}/rsvp", h.RSVP)
	mux.HandleFunc("DELETE /events/{id}/rsvp", h.RemoveRSVP)
	mux.HandleFunc("GET /events/{id}/rsvps", h.ListRSVPs)
}

type GuildEvent struct {
	ID          string     `json:"id"`
	GuildID     string     `json:"guildId"`
	CreatorID   string     `json:"creatorId"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Location    string     `json:"location"`
	StartTime   time.Time  `json:"startTime"`
	EndTime     *time.Time `json:"endTime,omitempty"`
	ImageURL    *string    `json:"imageUrl,omitempty"`
	Status      string     `json:"status"`
	Interested  int        `json:"interested"`
	Going       int        `json:"going"`
	MyRSVP      string     `json:"myRsvp,omitempty"` // filled per-request
	CreatedAt   time.Time  `json:"createdAt"`
}

type EventRSVP struct {
	UserID    string    `json:"userId"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

func (h *EventHandler) ListEvents(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")
	userID := getUserID(r)
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "scheduled"
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT e.id, e.guild_id, e.creator_id, e.name, e.description, e.location,
		       e.start_time, e.end_time, e.image_url, e.status, e.created_at,
		       COALESCE((SELECT COUNT(*) FROM guild_event_rsvps WHERE event_id = e.id AND status = 'interested'), 0),
		       COALESCE((SELECT COUNT(*) FROM guild_event_rsvps WHERE event_id = e.id AND status = 'going'), 0),
		       COALESCE((SELECT status FROM guild_event_rsvps WHERE event_id = e.id AND user_id = $3), '')
		FROM guild_events e
		WHERE e.guild_id = $1 AND e.status = $2
		ORDER BY e.start_time ASC`, guildID, status, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	defer rows.Close()

	events := []GuildEvent{}
	for rows.Next() {
		var ev GuildEvent
		if err := rows.Scan(&ev.ID, &ev.GuildID, &ev.CreatorID, &ev.Name, &ev.Description, &ev.Location,
			&ev.StartTime, &ev.EndTime, &ev.ImageURL, &ev.Status, &ev.CreatedAt,
			&ev.Interested, &ev.Going, &ev.MyRSVP); err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
			return
		}
		events = append(events, ev)
	}
	writeJSON(w, http.StatusOK, events)
}

func (h *EventHandler) CreateEvent(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")

	var body struct {
		Name        string  `json:"name"`
		Description string  `json:"description"`
		Location    string  `json:"location"`
		StartTime   string  `json:"startTime"`
		EndTime     *string `json:"endTime"`
		ImageURL    *string `json:"imageUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid body")
		return
	}
	if body.Name == "" || body.StartTime == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "name and startTime required")
		return
	}

	startTime, err := time.Parse(time.RFC3339, body.StartTime)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid startTime format (use RFC3339)")
		return
	}

	var endTime *time.Time
	if body.EndTime != nil && *body.EndTime != "" {
		t, err := time.Parse(time.RFC3339, *body.EndTime)
		if err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid endTime format")
			return
		}
		endTime = &t
	}

	var ev GuildEvent
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO guild_events (guild_id, creator_id, name, description, location, start_time, end_time, image_url)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, guild_id, creator_id, name, description, location, start_time, end_time, image_url, status, created_at`,
		guildID, userID, body.Name, body.Description, body.Location, startTime, endTime, body.ImageURL,
	).Scan(&ev.ID, &ev.GuildID, &ev.CreatorID, &ev.Name, &ev.Description, &ev.Location,
		&ev.StartTime, &ev.EndTime, &ev.ImageURL, &ev.Status, &ev.CreatedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	// Publish event
	publishGuildEvent(h.rdb, r.Context(), guildID, "GUILD_EVENT_CREATE", ev)

	writeJSON(w, http.StatusCreated, ev)
}

func (h *EventHandler) GetEvent(w http.ResponseWriter, r *http.Request) {
	eventID := r.PathValue("id")
	userID := getUserID(r)

	var ev GuildEvent
	err := h.db.QueryRowContext(r.Context(), `
		SELECT e.id, e.guild_id, e.creator_id, e.name, e.description, e.location,
		       e.start_time, e.end_time, e.image_url, e.status, e.created_at,
		       COALESCE((SELECT COUNT(*) FROM guild_event_rsvps WHERE event_id = e.id AND status = 'interested'), 0),
		       COALESCE((SELECT COUNT(*) FROM guild_event_rsvps WHERE event_id = e.id AND status = 'going'), 0),
		       COALESCE((SELECT status FROM guild_event_rsvps WHERE event_id = e.id AND user_id = $2), '')
		FROM guild_events e WHERE e.id = $1`, eventID, userID,
	).Scan(&ev.ID, &ev.GuildID, &ev.CreatorID, &ev.Name, &ev.Description, &ev.Location,
		&ev.StartTime, &ev.EndTime, &ev.ImageURL, &ev.Status, &ev.CreatedAt,
		&ev.Interested, &ev.Going, &ev.MyRSVP)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "event not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ev)
}

func (h *EventHandler) UpdateEvent(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	eventID := r.PathValue("id")

	// Check creator
	var creatorID, guildID string
	err := h.db.QueryRowContext(r.Context(), `SELECT creator_id, guild_id FROM guild_events WHERE id = $1`, eventID).Scan(&creatorID, &guildID)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "event not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	if creatorID != userID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only event creator can edit")
		return
	}

	var body struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		Location    *string `json:"location"`
		StartTime   *string `json:"startTime"`
		EndTime     *string `json:"endTime"`
		ImageURL    *string `json:"imageUrl"`
		Status      *string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid body")
		return
	}

	// Read current, merge, write back
	var ev GuildEvent
	h.db.QueryRowContext(r.Context(), `
		SELECT id, guild_id, creator_id, name, description, location, start_time, end_time, image_url, status, created_at
		FROM guild_events WHERE id = $1`, eventID,
	).Scan(&ev.ID, &ev.GuildID, &ev.CreatorID, &ev.Name, &ev.Description, &ev.Location,
		&ev.StartTime, &ev.EndTime, &ev.ImageURL, &ev.Status, &ev.CreatedAt)

	if body.Name != nil {
		ev.Name = *body.Name
	}
	if body.Description != nil {
		ev.Description = *body.Description
	}
	if body.Location != nil {
		ev.Location = *body.Location
	}
	if body.StartTime != nil {
		if t, err := time.Parse(time.RFC3339, *body.StartTime); err == nil {
			ev.StartTime = t
		}
	}
	if body.EndTime != nil {
		if *body.EndTime == "" {
			ev.EndTime = nil
		} else if t, err := time.Parse(time.RFC3339, *body.EndTime); err == nil {
			ev.EndTime = &t
		}
	}
	if body.ImageURL != nil {
		ev.ImageURL = body.ImageURL
	}
	if body.Status != nil {
		ev.Status = *body.Status
	}

	_, err = h.db.ExecContext(r.Context(), `
		UPDATE guild_events SET name=$1, description=$2, location=$3, start_time=$4, end_time=$5, image_url=$6, status=$7, updated_at=NOW()
		WHERE id=$8`,
		ev.Name, ev.Description, ev.Location, ev.StartTime, ev.EndTime, ev.ImageURL, ev.Status, eventID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	publishGuildEvent(h.rdb, r.Context(), guildID, "GUILD_EVENT_UPDATE", ev)
	writeJSON(w, http.StatusOK, ev)
}

func (h *EventHandler) DeleteEvent(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	eventID := r.PathValue("id")

	var creatorID, guildID string
	err := h.db.QueryRowContext(r.Context(), `SELECT creator_id, guild_id FROM guild_events WHERE id = $1`, eventID).Scan(&creatorID, &guildID)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "event not found")
		return
	}
	if creatorID != userID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only event creator can delete")
		return
	}

	h.db.ExecContext(r.Context(), `DELETE FROM guild_events WHERE id = $1`, eventID)

	publishGuildEvent(h.rdb, r.Context(), guildID, "GUILD_EVENT_DELETE", map[string]string{"id": eventID})
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *EventHandler) RSVP(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	eventID := r.PathValue("id")

	var body struct {
		Status string `json:"status"` // "interested" or "going"
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || (body.Status != "interested" && body.Status != "going") {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "status must be 'interested' or 'going'")
		return
	}

	_, err := h.db.ExecContext(r.Context(), `
		INSERT INTO guild_event_rsvps (event_id, user_id, status)
		VALUES ($1, $2, $3)
		ON CONFLICT (event_id, user_id) DO UPDATE SET status = $3`,
		eventID, userID, body.Status)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": body.Status})
}

func (h *EventHandler) RemoveRSVP(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	eventID := r.PathValue("id")

	h.db.ExecContext(r.Context(), `DELETE FROM guild_event_rsvps WHERE event_id = $1 AND user_id = $2`, eventID, userID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

func (h *EventHandler) ListRSVPs(w http.ResponseWriter, r *http.Request) {
	eventID := r.PathValue("id")

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT user_id, status, created_at FROM guild_event_rsvps
		WHERE event_id = $1 ORDER BY created_at`, eventID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	defer rows.Close()

	rsvps := []EventRSVP{}
	for rows.Next() {
		var rsvp EventRSVP
		rows.Scan(&rsvp.UserID, &rsvp.Status, &rsvp.CreatedAt)
		rsvps = append(rsvps, rsvp)
	}
	writeJSON(w, http.StatusOK, rsvps)
}

func publishGuildEvent(rdb *redis.Client, ctx context.Context, guildID, eventType string, data interface{}) {
	payload, _ := json.Marshal(map[string]interface{}{
		"type": eventType,
		"data": data,
	})
	rdb.Publish(ctx, "guild:"+guildID, string(payload))
}
