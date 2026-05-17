package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/decatrondev/nexe/services/guilds/internal/repository"
	"github.com/redis/go-redis/v9"
)

// WS event types for relationships
const (
	EventRelationshipCreate = "RELATIONSHIP_CREATE"
	EventRelationshipUpdate = "RELATIONSHIP_UPDATE"
	EventRelationshipRemove = "RELATIONSHIP_REMOVE"
)

type RelationshipHandler struct {
	repo *repository.RelationshipRepository
	db   *sql.DB
	rdb  *redis.Client
}

func NewRelationshipHandler(repo *repository.RelationshipRepository, db *sql.DB, rdb *redis.Client) *RelationshipHandler {
	return &RelationshipHandler{repo: repo, db: db, rdb: rdb}
}

func (h *RelationshipHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /relationships", h.ListRelationships)
	mux.HandleFunc("POST /relationships", h.CreateRelationship)
	mux.HandleFunc("PATCH /relationships/{id}", h.UpdateRelationship)
	mux.HandleFunc("DELETE /relationships/{id}", h.DeleteRelationship)
	mux.HandleFunc("GET /relationships/mutual/{userId}", h.MutualFriends)
}

// enrichRelWithUsers adds user info to a relationship for WS events.
func (h *RelationshipHandler) enrichRelWithUsers(ctx context.Context, rel *repository.Relationship) map[string]interface{} {
	users := h.fetchUserInfos(ctx, []string{rel.UserID, rel.TargetID})
	return map[string]interface{}{
		"relationship": rel,
		"users":        users,
	}
}

// publishToUser sends an event to a specific user via Redis → Gateway WS.
func (h *RelationshipHandler) publishToUser(ctx context.Context, userID, eventType string, data interface{}) {
	event := struct {
		Type string      `json:"type"`
		Data interface{} `json:"data"`
	}{Type: eventType, Data: data}

	payload, err := json.Marshal(event)
	if err != nil {
		slog.Error("failed to marshal relationship event", "error", err)
		return
	}

	channel := fmt.Sprintf("nexe:notifications:user:%s", userID)
	if err := h.rdb.Publish(ctx, channel, payload).Err(); err != nil {
		slog.Error("failed to publish relationship event", "error", err, "user", userID)
	}
}

// ListRelationships returns relationships filtered by type.
// GET /relationships?type=friend|pending|blocked
func (h *RelationshipHandler) ListRelationships(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	relType := r.URL.Query().Get("type")

	var rels []repository.Relationship
	var err error

	switch relType {
	case "friend":
		rels, err = h.repo.ListFriends(r.Context(), userID)
	case "pending":
		// Outgoing requests
		outgoing, err1 := h.repo.ListByUser(r.Context(), userID, "pending")
		// Incoming requests
		incoming, err2 := h.repo.ListPendingIncoming(r.Context(), userID)
		if err1 != nil {
			err = err1
		} else if err2 != nil {
			err = err2
		} else {
			rels = append(outgoing, incoming...)
		}
	case "blocked":
		rels, err = h.repo.ListBlocked(r.Context(), userID)
	default:
		// Return all
		friends, _ := h.repo.ListFriends(r.Context(), userID)
		pending, _ := h.repo.ListByUser(r.Context(), userID, "pending")
		incoming, _ := h.repo.ListPendingIncoming(r.Context(), userID)
		blocked, _ := h.repo.ListBlocked(r.Context(), userID)
		rels = append(friends, pending...)
		rels = append(rels, incoming...)
		rels = append(rels, blocked...)
	}

	if err != nil {
		writeError(w, http.StatusInternalServerError, "relationship_error", err.Error())
		return
	}
	if rels == nil {
		rels = []repository.Relationship{}
	}

	// Enrich with user info
	userIDs := collectRelUserIDs(rels, userID)
	users := h.fetchUserInfos(r.Context(), userIDs)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"relationships": rels,
		"users":         users,
	})
}

// CreateRelationship handles friend requests and blocking.
// POST /relationships { "targetUsername": "foo", "type": "pending" | "blocked" }
func (h *RelationshipHandler) CreateRelationship(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	var body struct {
		TargetID       string `json:"targetId"`
		TargetUsername string `json:"targetUsername"`
		Type           string `json:"type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	if body.Type != "pending" && body.Type != "blocked" {
		writeError(w, http.StatusBadRequest, "invalid_type", "type must be 'pending' or 'blocked'")
		return
	}

	targetID := body.TargetID
	if targetID == "" && body.TargetUsername != "" {
		// Resolve username to user ID via the users table
		targetID = h.resolveUsername(r.Context(), body.TargetUsername)
		if targetID == "" {
			writeError(w, http.StatusNotFound, "user_not_found", "user not found")
			return
		}
	}

	if targetID == "" {
		writeError(w, http.StatusBadRequest, "missing_target", "targetId or targetUsername required")
		return
	}

	if targetID == userID {
		writeError(w, http.StatusBadRequest, "self_relationship", "cannot add yourself")
		return
	}

	// Check if target has blocked the user
	if body.Type == "pending" {
		blocked, _ := h.repo.IsBlocked(r.Context(), userID, targetID)
		if blocked {
			writeError(w, http.StatusForbidden, "blocked", "unable to send friend request")
			return
		}
	}

	// Check existing relationship
	existing, _ := h.repo.GetBetween(r.Context(), userID, targetID)

	if body.Type == "blocked" {
		// Delete any existing relationship first (both directions)
		h.repo.DeleteBetween(r.Context(), userID, targetID)

		rel := &repository.Relationship{
			UserID:   userID,
			TargetID: targetID,
			Type:     "blocked",
		}
		if err := h.repo.Create(r.Context(), rel); err != nil {
			writeError(w, http.StatusInternalServerError, "relationship_error", err.Error())
			return
		}

		// Notify the blocker only
		h.publishToUser(r.Context(), userID, EventRelationshipCreate, rel)
		writeJSON(w, http.StatusCreated, rel)
		return
	}

	// Friend request flow
	if existing != nil {
		if existing.Type == "friend" {
			writeError(w, http.StatusConflict, "already_friends", "already friends")
			return
		}
		if existing.Type == "pending" {
			writeError(w, http.StatusConflict, "already_pending", "friend request already sent")
			return
		}
	}

	// Check if the OTHER person already sent us a request → auto-accept
	reverse, _ := h.repo.GetBetween(r.Context(), targetID, userID)
	if reverse != nil && reverse.Type == "pending" {
		// Accept: update both sides to friend
		h.repo.UpdateType(r.Context(), reverse.ID, "friend")
		// Create the reverse friend entry
		friendRel := &repository.Relationship{
			UserID:   userID,
			TargetID: targetID,
			Type:     "friend",
		}
		if err := h.repo.Create(r.Context(), friendRel); err != nil {
			writeError(w, http.StatusInternalServerError, "relationship_error", err.Error())
			return
		}
		reverse.Type = "friend"

		// Notify both users
		h.publishToUser(r.Context(), userID, EventRelationshipUpdate, friendRel)
		h.publishToUser(r.Context(), targetID, EventRelationshipUpdate, reverse)
		writeJSON(w, http.StatusCreated, friendRel)
		return
	}

	// Create pending request
	rel := &repository.Relationship{
		UserID:   userID,
		TargetID: targetID,
		Type:     "pending",
	}
	if err := h.repo.Create(r.Context(), rel); err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			writeError(w, http.StatusConflict, "already_exists", "relationship already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "relationship_error", err.Error())
		return
	}

	// Notify both: sender sees their outgoing request, target sees incoming
	h.publishToUser(r.Context(), userID, EventRelationshipCreate, rel)
	h.publishToUser(r.Context(), targetID, EventRelationshipCreate, rel)
	writeJSON(w, http.StatusCreated, rel)
}

// UpdateRelationship handles accepting requests, updating notes, and toggling favorites.
// PATCH /relationships/:id { "action": "accept" } or { "note": "...", "isFavorite": true }
func (h *RelationshipHandler) UpdateRelationship(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	relID := r.PathValue("id")

	rel, err := h.repo.GetByID(r.Context(), relID)
	if err != nil || rel == nil {
		writeError(w, http.StatusNotFound, "not_found", "relationship not found")
		return
	}

	var body struct {
		Action     string  `json:"action"`
		Note       *string `json:"note"`
		IsFavorite *bool   `json:"isFavorite"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	if body.Action == "accept" {
		// Only the target of a pending request can accept
		if rel.TargetID != userID || rel.Type != "pending" {
			writeError(w, http.StatusForbidden, "forbidden", "cannot accept this request")
			return
		}

		// Update sender's row to friend
		h.repo.UpdateType(r.Context(), rel.ID, "friend")

		// Create reciprocal friend entry
		friendRel := &repository.Relationship{
			UserID:   userID,
			TargetID: rel.UserID,
			Type:     "friend",
		}
		if err := h.repo.Create(r.Context(), friendRel); err != nil {
			writeError(w, http.StatusInternalServerError, "relationship_error", err.Error())
			return
		}

		rel.Type = "friend"
		h.publishToUser(r.Context(), rel.UserID, EventRelationshipUpdate, rel)
		h.publishToUser(r.Context(), userID, EventRelationshipUpdate, friendRel)
		writeJSON(w, http.StatusOK, friendRel)
		return
	}

	// Note / favorite updates — only the owner can update
	if rel.UserID != userID {
		writeError(w, http.StatusForbidden, "forbidden", "not your relationship")
		return
	}

	if err := h.repo.Update(r.Context(), relID, body.Note, body.IsFavorite); err != nil {
		writeError(w, http.StatusInternalServerError, "relationship_error", err.Error())
		return
	}

	// Refresh and return
	updated, _ := h.repo.GetByID(r.Context(), relID)
	if updated != nil {
		h.publishToUser(r.Context(), userID, EventRelationshipUpdate, updated)
	}
	writeJSON(w, http.StatusOK, updated)
}

// DeleteRelationship handles rejecting requests, unfriending, and unblocking.
// DELETE /relationships/:id
func (h *RelationshipHandler) DeleteRelationship(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	relID := r.PathValue("id")

	rel, err := h.repo.GetByID(r.Context(), relID)
	if err != nil || rel == nil {
		writeError(w, http.StatusNotFound, "not_found", "relationship not found")
		return
	}

	// Sender can cancel pending, target can reject pending, either can unfriend, owner can unblock
	canDelete := false
	switch rel.Type {
	case "pending":
		canDelete = rel.UserID == userID || rel.TargetID == userID
	case "friend":
		canDelete = rel.UserID == userID || rel.TargetID == userID
	case "blocked":
		canDelete = rel.UserID == userID
	}

	if !canDelete {
		writeError(w, http.StatusForbidden, "forbidden", "cannot delete this relationship")
		return
	}

	otherID := rel.TargetID
	if rel.TargetID == userID {
		otherID = rel.UserID
	}

	if rel.Type == "friend" {
		// Remove both directions
		h.repo.DeleteBetween(r.Context(), userID, otherID)
	} else {
		h.repo.Delete(r.Context(), relID)
	}

	// Notify both users (except for block/unblock — only notify the actor)
	removeData := map[string]string{"id": relID, "userId": rel.UserID, "targetId": rel.TargetID, "type": rel.Type}
	h.publishToUser(r.Context(), userID, EventRelationshipRemove, removeData)
	if rel.Type != "blocked" {
		h.publishToUser(r.Context(), otherID, EventRelationshipRemove, removeData)
	}

	w.WriteHeader(http.StatusNoContent)
}

// MutualFriends returns mutual friend IDs between the requester and the given user.
// GET /relationships/mutual/:userId
func (h *RelationshipHandler) MutualFriends(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	otherID := r.PathValue("userId")

	ids, err := h.repo.MutualFriends(r.Context(), userID, otherID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "relationship_error", err.Error())
		return
	}
	if ids == nil {
		ids = []string{}
	}
	writeJSON(w, http.StatusOK, ids)
}

// RelUserInfo is basic user info returned alongside relationships.
type RelUserInfo struct {
	ID        string  `json:"id"`
	Username  string  `json:"username"`
	AvatarURL *string `json:"avatarUrl,omitempty"`
}

// fetchUserInfos returns basic user info for a list of user IDs.
func (h *RelationshipHandler) fetchUserInfos(ctx context.Context, userIDs []string) map[string]RelUserInfo {
	if len(userIDs) == 0 {
		return map[string]RelUserInfo{}
	}
	result := make(map[string]RelUserInfo, len(userIDs))

	// Build query with IN clause
	placeholders := make([]string, len(userIDs))
	args := make([]interface{}, len(userIDs))
	for i, id := range userIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	query := fmt.Sprintf(
		`SELECT u.id, u.username, p.avatar_url FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id IN (%s)`,
		strings.Join(placeholders, ","),
	)
	rows, err := h.db.QueryContext(ctx, query, args...)
	if err != nil {
		return result
	}
	defer rows.Close()

	for rows.Next() {
		var info RelUserInfo
		if err := rows.Scan(&info.ID, &info.Username, &info.AvatarURL); err != nil {
			continue
		}
		result[info.ID] = info
	}
	return result
}

// collectRelUserIDs gathers all unique "other" user IDs from relationships.
func collectRelUserIDs(rels []repository.Relationship, myID string) []string {
	seen := make(map[string]bool)
	var ids []string
	for _, r := range rels {
		other := r.TargetID
		if r.TargetID == myID {
			other = r.UserID
		}
		if !seen[other] {
			seen[other] = true
			ids = append(ids, other)
		}
	}
	return ids
}

// resolveUsername looks up a user ID by username (case-insensitive).
func (h *RelationshipHandler) resolveUsername(ctx context.Context, username string) string {
	var userID string
	err := h.db.QueryRowContext(ctx,
		`SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND disabled = false`, username,
	).Scan(&userID)
	if err != nil {
		return ""
	}
	return userID
}
