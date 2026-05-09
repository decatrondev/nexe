package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/decatrondev/nexe/services/messaging/internal/model"
)

type ReactionRepository struct {
	db *sql.DB
}

func NewReactionRepository(db *sql.DB) *ReactionRepository {
	return &ReactionRepository{db: db}
}

func (r *ReactionRepository) Add(ctx context.Context, messageID, userID, emoji string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO reactions (message_id, user_id, emoji)
		 VALUES ($1, $2, $3)
		 ON CONFLICT DO NOTHING`,
		messageID, userID, emoji,
	)
	if err != nil {
		return fmt.Errorf("reaction add: %w", err)
	}
	return nil
}

func (r *ReactionRepository) Remove(ctx context.Context, messageID, userID, emoji string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
		messageID, userID, emoji,
	)
	if err != nil {
		return fmt.Errorf("reaction remove: %w", err)
	}
	return nil
}

func (r *ReactionRepository) ListByMessage(ctx context.Context, messageID string) ([]model.ReactionGroup, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT emoji, COUNT(*) as count,
		        ARRAY_AGG(user_id::text ORDER BY created_at) as users
		 FROM reactions
		 WHERE message_id = $1
		 GROUP BY emoji
		 ORDER BY MIN(created_at)`,
		messageID,
	)
	if err != nil {
		return nil, fmt.Errorf("reaction list by message: %w", err)
	}
	defer rows.Close()

	var groups []model.ReactionGroup
	for rows.Next() {
		var rg model.ReactionGroup
		var users pqStringArray
		if err := rows.Scan(&rg.Emoji, &rg.Count, &users); err != nil {
			return nil, fmt.Errorf("reaction list by message scan: %w", err)
		}
		rg.Users = []string(users)
		groups = append(groups, rg)
	}
	return groups, rows.Err()
}

func (r *ReactionRepository) RemoveAll(ctx context.Context, messageID string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM reactions WHERE message_id = $1`,
		messageID,
	)
	if err != nil {
		return fmt.Errorf("reaction remove all: %w", err)
	}
	return nil
}
