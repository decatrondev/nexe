package repository

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
)

type ChannelOverride struct {
	ID         string `json:"id"`
	ChannelID  string `json:"channelId"`
	TargetID   string `json:"targetId"`
	TargetType string `json:"targetType"` // "role" or "user"
	Allow      int64  `json:"allow"`
	Deny       int64  `json:"deny"`
}

type OverrideRepository struct {
	db *sql.DB
}

func NewOverrideRepository(db *sql.DB) *OverrideRepository {
	return &OverrideRepository{db: db}
}

func (r *OverrideRepository) ListByChannel(ctx context.Context, channelID string) ([]ChannelOverride, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, channel_id, target_id, target_type, allow, deny
		 FROM channel_overrides WHERE channel_id = $1`, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var overrides []ChannelOverride
	for rows.Next() {
		var o ChannelOverride
		if err := rows.Scan(&o.ID, &o.ChannelID, &o.TargetID, &o.TargetType, &o.Allow, &o.Deny); err != nil {
			return nil, err
		}
		overrides = append(overrides, o)
	}
	return overrides, nil
}

func (r *OverrideRepository) Upsert(ctx context.Context, o *ChannelOverride) error {
	if o.ID == "" {
		o.ID = uuid.New().String()
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO channel_overrides (id, channel_id, target_id, target_type, allow, deny)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (channel_id, target_id, target_type)
		 DO UPDATE SET allow = $5, deny = $6`,
		o.ID, o.ChannelID, o.TargetID, o.TargetType, o.Allow, o.Deny)
	return err
}

func (r *OverrideRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM channel_overrides WHERE id = $1`, id)
	return err
}
