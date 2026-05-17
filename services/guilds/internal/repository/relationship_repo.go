package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type Relationship struct {
	ID         string    `json:"id"`
	UserID     string    `json:"userId"`
	TargetID   string    `json:"targetId"`
	Type       string    `json:"type"` // "pending", "friend", "blocked"
	Note       string    `json:"note"`
	IsFavorite bool      `json:"isFavorite"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type RelationshipRepository struct {
	db *sql.DB
}

func NewRelationshipRepository(db *sql.DB) *RelationshipRepository {
	return &RelationshipRepository{db: db}
}

func (r *RelationshipRepository) Create(ctx context.Context, rel *Relationship) error {
	return r.db.QueryRowContext(ctx,
		`INSERT INTO relationships (user_id, target_id, type, note, is_favorite)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, created_at, updated_at`,
		rel.UserID, rel.TargetID, rel.Type, rel.Note, rel.IsFavorite,
	).Scan(&rel.ID, &rel.CreatedAt, &rel.UpdatedAt)
}

func (r *RelationshipRepository) GetByID(ctx context.Context, id string) (*Relationship, error) {
	var rel Relationship
	err := r.db.QueryRowContext(ctx,
		`SELECT id, user_id, target_id, type, note, is_favorite, created_at, updated_at
		 FROM relationships WHERE id = $1`, id,
	).Scan(&rel.ID, &rel.UserID, &rel.TargetID, &rel.Type, &rel.Note, &rel.IsFavorite, &rel.CreatedAt, &rel.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rel, nil
}

// GetBetween returns the relationship from userID → targetID (directional).
func (r *RelationshipRepository) GetBetween(ctx context.Context, userID, targetID string) (*Relationship, error) {
	var rel Relationship
	err := r.db.QueryRowContext(ctx,
		`SELECT id, user_id, target_id, type, note, is_favorite, created_at, updated_at
		 FROM relationships WHERE user_id = $1 AND target_id = $2`, userID, targetID,
	).Scan(&rel.ID, &rel.UserID, &rel.TargetID, &rel.Type, &rel.Note, &rel.IsFavorite, &rel.CreatedAt, &rel.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rel, nil
}

// ListByUser returns all relationships of a given type for a user.
func (r *RelationshipRepository) ListByUser(ctx context.Context, userID, relType string) ([]Relationship, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, user_id, target_id, type, note, is_favorite, created_at, updated_at
		 FROM relationships WHERE user_id = $1 AND type = $2
		 ORDER BY is_favorite DESC, created_at DESC`, userID, relType,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rels []Relationship
	for rows.Next() {
		var rel Relationship
		if err := rows.Scan(&rel.ID, &rel.UserID, &rel.TargetID, &rel.Type, &rel.Note, &rel.IsFavorite, &rel.CreatedAt, &rel.UpdatedAt); err != nil {
			return nil, err
		}
		rels = append(rels, rel)
	}
	return rels, nil
}

// ListFriends returns mutual friend relationships (both sides are 'friend').
func (r *RelationshipRepository) ListFriends(ctx context.Context, userID string) ([]Relationship, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, user_id, target_id, type, note, is_favorite, created_at, updated_at
		 FROM relationships WHERE user_id = $1 AND type = 'friend'
		 ORDER BY is_favorite DESC, created_at DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rels []Relationship
	for rows.Next() {
		var rel Relationship
		if err := rows.Scan(&rel.ID, &rel.UserID, &rel.TargetID, &rel.Type, &rel.Note, &rel.IsFavorite, &rel.CreatedAt, &rel.UpdatedAt); err != nil {
			return nil, err
		}
		rels = append(rels, rel)
	}
	return rels, nil
}

// ListPendingIncoming returns friend requests sent TO this user.
func (r *RelationshipRepository) ListPendingIncoming(ctx context.Context, userID string) ([]Relationship, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, user_id, target_id, type, note, is_favorite, created_at, updated_at
		 FROM relationships WHERE target_id = $1 AND type = 'pending'
		 ORDER BY created_at DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rels []Relationship
	for rows.Next() {
		var rel Relationship
		if err := rows.Scan(&rel.ID, &rel.UserID, &rel.TargetID, &rel.Type, &rel.Note, &rel.IsFavorite, &rel.CreatedAt, &rel.UpdatedAt); err != nil {
			return nil, err
		}
		rels = append(rels, rel)
	}
	return rels, nil
}

// ListBlocked returns users blocked by this user.
func (r *RelationshipRepository) ListBlocked(ctx context.Context, userID string) ([]Relationship, error) {
	return r.ListByUser(ctx, userID, "blocked")
}

// Update updates note and is_favorite fields.
func (r *RelationshipRepository) Update(ctx context.Context, id string, note *string, isFavorite *bool) error {
	if note == nil && isFavorite == nil {
		return nil
	}
	query := "UPDATE relationships SET updated_at = NOW()"
	args := []interface{}{}
	argIdx := 1

	if note != nil {
		query += fmt.Sprintf(", note = $%d", argIdx)
		args = append(args, *note)
		argIdx++
	}
	if isFavorite != nil {
		query += fmt.Sprintf(", is_favorite = $%d", argIdx)
		args = append(args, *isFavorite)
		argIdx++
	}

	query += fmt.Sprintf(" WHERE id = $%d", argIdx)
	args = append(args, id)

	_, err := r.db.ExecContext(ctx, query, args...)
	return err
}

// UpdateType changes the relationship type (e.g. pending → friend).
func (r *RelationshipRepository) UpdateType(ctx context.Context, id, relType string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE relationships SET type = $1, updated_at = NOW() WHERE id = $2`,
		relType, id,
	)
	return err
}

func (r *RelationshipRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM relationships WHERE id = $1`, id)
	return err
}

// DeleteBetween removes the relationship between two users (both directions).
func (r *RelationshipRepository) DeleteBetween(ctx context.Context, userID, targetID string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM relationships WHERE (user_id = $1 AND target_id = $2) OR (user_id = $2 AND target_id = $1)`,
		userID, targetID,
	)
	return err
}

// IsBlocked checks if targetID has blocked userID.
func (r *RelationshipRepository) IsBlocked(ctx context.Context, userID, targetID string) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM relationships WHERE user_id = $1 AND target_id = $2 AND type = 'blocked')`,
		targetID, userID,
	).Scan(&exists)
	return exists, err
}

// MutualFriends returns IDs of users who are friends with both userA and userB.
func (r *RelationshipRepository) MutualFriends(ctx context.Context, userA, userB string) ([]string, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT r1.target_id FROM relationships r1
		 JOIN relationships r2 ON r1.target_id = r2.target_id
		 WHERE r1.user_id = $1 AND r1.type = 'friend'
		   AND r2.user_id = $2 AND r2.type = 'friend'`,
		userA, userB,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}
