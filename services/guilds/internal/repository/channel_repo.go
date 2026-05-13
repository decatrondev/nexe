package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/decatrondev/nexe/services/guilds/internal/model"
)

type ChannelRepository struct {
	db *sql.DB
}

func NewChannelRepository(db *sql.DB) *ChannelRepository {
	return &ChannelRepository{db: db}
}

func (r *ChannelRepository) Create(ctx context.Context, ch *model.Channel) error {
	err := r.db.QueryRowContext(ctx,
		`INSERT INTO channels (guild_id, category_id, name, topic, type, position, slowmode_seconds, is_sub_only, is_live_channel)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING id, created_at, updated_at`,
		ch.GuildID, ch.CategoryID, ch.Name, ch.Topic, ch.Type, ch.Position,
		ch.SlowmodeSeconds, ch.IsSubOnly, ch.IsLiveChannel,
	).Scan(&ch.ID, &ch.CreatedAt, &ch.UpdatedAt)
	if err != nil {
		return fmt.Errorf("channel create: %w", err)
	}
	return nil
}

func (r *ChannelRepository) GetByID(ctx context.Context, id string) (*model.Channel, error) {
	var ch model.Channel
	err := r.db.QueryRowContext(ctx,
		`SELECT id, guild_id, category_id, name, topic, type, position,
		        slowmode_seconds, is_sub_only, is_live_channel, created_at, updated_at
		 FROM channels WHERE id = $1`, id,
	).Scan(
		&ch.ID, &ch.GuildID, &ch.CategoryID, &ch.Name, &ch.Topic, &ch.Type, &ch.Position,
		&ch.SlowmodeSeconds, &ch.IsSubOnly, &ch.IsLiveChannel, &ch.CreatedAt, &ch.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("channel get by id: %w", err)
	}
	return &ch, nil
}

func (r *ChannelRepository) ListByGuild(ctx context.Context, guildID string) ([]model.Channel, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, guild_id, category_id, name, topic, type, position,
		        slowmode_seconds, is_sub_only, is_live_channel, created_at, updated_at
		 FROM channels WHERE guild_id = $1 ORDER BY position`, guildID,
	)
	if err != nil {
		return nil, fmt.Errorf("channel list by guild: %w", err)
	}
	defer rows.Close()

	var channels []model.Channel
	for rows.Next() {
		var ch model.Channel
		if err := rows.Scan(
			&ch.ID, &ch.GuildID, &ch.CategoryID, &ch.Name, &ch.Topic, &ch.Type, &ch.Position,
			&ch.SlowmodeSeconds, &ch.IsSubOnly, &ch.IsLiveChannel, &ch.CreatedAt, &ch.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("channel list by guild scan: %w", err)
		}
		channels = append(channels, ch)
	}
	return channels, rows.Err()
}

func (r *ChannelRepository) Update(ctx context.Context, ch *model.Channel) error {
	err := r.db.QueryRowContext(ctx,
		`UPDATE channels
		 SET category_id = $1, name = $2, topic = $3, type = $4, position = $5,
		     slowmode_seconds = $6, is_sub_only = $7, is_live_channel = $8, updated_at = NOW()
		 WHERE id = $9
		 RETURNING id, guild_id, category_id, name, topic, type, position,
		           slowmode_seconds, is_sub_only, is_live_channel, created_at, updated_at`,
		ch.CategoryID, ch.Name, ch.Topic, ch.Type, ch.Position,
		ch.SlowmodeSeconds, ch.IsSubOnly, ch.IsLiveChannel, ch.ID,
	).Scan(
		&ch.ID, &ch.GuildID, &ch.CategoryID, &ch.Name, &ch.Topic, &ch.Type,
		&ch.Position, &ch.SlowmodeSeconds, &ch.IsSubOnly, &ch.IsLiveChannel,
		&ch.CreatedAt, &ch.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("channel update: %w", err)
	}
	return nil
}

func (r *ChannelRepository) CountByGuild(ctx context.Context, guildID string) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM channels WHERE guild_id = $1`, guildID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("channel count by guild: %w", err)
	}
	return count, nil
}

func (r *ChannelRepository) ReorderChannels(ctx context.Context, guildID string, channelIDs []string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("channel reorder begin tx: %w", err)
	}
	defer tx.Rollback()

	for i, id := range channelIDs {
		_, err := tx.ExecContext(ctx,
			`UPDATE channels SET position = $1, updated_at = NOW() WHERE id = $2 AND guild_id = $3`,
			i, id, guildID)
		if err != nil {
			return fmt.Errorf("channel reorder update: %w", err)
		}
	}

	return tx.Commit()
}

func (r *ChannelRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM channels WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("channel delete: %w", err)
	}
	return nil
}
