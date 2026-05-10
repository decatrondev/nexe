package repository

import (
	"context"
	"database/sql"

	"github.com/decatrondev/nexe/services/notifications/internal/model"
)

type PreferenceRepository struct {
	db *sql.DB
}

func NewPreferenceRepository(db *sql.DB) *PreferenceRepository {
	return &PreferenceRepository{db: db}
}

func (r *PreferenceRepository) Get(ctx context.Context, userID, guildID string) (*model.NotificationPreference, error) {
	var pref model.NotificationPreference
	err := r.db.QueryRowContext(ctx,
		`SELECT user_id, guild_id, channel_id, level FROM notification_preferences
		 WHERE user_id = $1 AND guild_id = $2 AND channel_id IS NULL`,
		userID, guildID,
	).Scan(&pref.UserID, &pref.GuildID, &pref.ChannelID, &pref.Level)

	if err == sql.ErrNoRows {
		// Default: mentions only
		return &model.NotificationPreference{
			UserID:  userID,
			GuildID: guildID,
			Level:   model.PrefMentions,
		}, nil
	}
	if err != nil {
		return nil, err
	}
	return &pref, nil
}

func (r *PreferenceRepository) GetChannel(ctx context.Context, userID, guildID, channelID string) (*model.NotificationPreference, error) {
	var pref model.NotificationPreference
	err := r.db.QueryRowContext(ctx,
		`SELECT user_id, guild_id, channel_id, level FROM notification_preferences
		 WHERE user_id = $1 AND guild_id = $2 AND channel_id = $3`,
		userID, guildID, channelID,
	).Scan(&pref.UserID, &pref.GuildID, &pref.ChannelID, &pref.Level)

	if err == sql.ErrNoRows {
		return nil, nil // no override, use guild-level
	}
	if err != nil {
		return nil, err
	}
	return &pref, nil
}

func (r *PreferenceRepository) Upsert(ctx context.Context, pref *model.NotificationPreference) error {
	if pref.ChannelID != nil {
		_, err := r.db.ExecContext(ctx,
			`INSERT INTO notification_preferences (user_id, guild_id, channel_id, level)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (user_id, guild_id, channel_id) DO UPDATE SET level = $4`,
			pref.UserID, pref.GuildID, pref.ChannelID, pref.Level,
		)
		return err
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO notification_preferences (user_id, guild_id, level)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, guild_id) WHERE channel_id IS NULL DO UPDATE SET level = $3`,
		pref.UserID, pref.GuildID, pref.Level,
	)
	return err
}
