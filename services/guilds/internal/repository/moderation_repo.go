package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/decatrondev/nexe/services/guilds/internal/model"
)

type ModerationRepository struct {
	db *sql.DB
}

func NewModerationRepository(db *sql.DB) *ModerationRepository {
	return &ModerationRepository{db: db}
}

func (r *ModerationRepository) Ban(ctx context.Context, guildID, userID, bannedBy, reason string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO bans (guild_id, user_id, banned_by, reason)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (guild_id, user_id) DO UPDATE SET banned_by = $3, reason = $4, created_at = NOW()`,
		guildID, userID, bannedBy, reason,
	)
	if err != nil {
		return fmt.Errorf("moderation ban: %w", err)
	}
	return nil
}

func (r *ModerationRepository) Unban(ctx context.Context, guildID, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM bans WHERE guild_id = $1 AND user_id = $2`,
		guildID, userID,
	)
	if err != nil {
		return fmt.Errorf("moderation unban: %w", err)
	}
	return nil
}

func (r *ModerationRepository) GetBan(ctx context.Context, guildID, userID string) (*model.Ban, error) {
	var ban model.Ban
	err := r.db.QueryRowContext(ctx,
		`SELECT guild_id, user_id, banned_by, reason, created_at
		 FROM bans WHERE guild_id = $1 AND user_id = $2`,
		guildID, userID,
	).Scan(&ban.GuildID, &ban.UserID, &ban.BannedBy, &ban.Reason, &ban.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("moderation get ban: %w", err)
	}
	return &ban, nil
}

func (r *ModerationRepository) ListBans(ctx context.Context, guildID string) ([]model.Ban, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT guild_id, user_id, banned_by, reason, created_at
		 FROM bans WHERE guild_id = $1 ORDER BY created_at DESC`, guildID,
	)
	if err != nil {
		return nil, fmt.Errorf("moderation list bans: %w", err)
	}
	defer rows.Close()

	var bans []model.Ban
	for rows.Next() {
		var ban model.Ban
		if err := rows.Scan(&ban.GuildID, &ban.UserID, &ban.BannedBy, &ban.Reason, &ban.CreatedAt); err != nil {
			return nil, fmt.Errorf("moderation list bans scan: %w", err)
		}
		bans = append(bans, ban)
	}
	return bans, rows.Err()
}

func (r *ModerationRepository) Timeout(ctx context.Context, guildID, userID string, duration time.Duration) error {
	mutedUntil := time.Now().Add(duration)
	_, err := r.db.ExecContext(ctx,
		`UPDATE guild_members SET muted = true, muted_until = $1
		 WHERE guild_id = $2 AND user_id = $3`,
		mutedUntil, guildID, userID,
	)
	if err != nil {
		return fmt.Errorf("moderation timeout: %w", err)
	}
	return nil
}

func (r *ModerationRepository) LogAction(ctx context.Context, log *model.ModerationLog) error {
	err := r.db.QueryRowContext(ctx,
		`INSERT INTO moderation_logs (guild_id, moderator_id, target_id, action, reason, duration_seconds)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, created_at`,
		log.GuildID, log.ModeratorID, log.TargetID, log.Action, log.Reason, log.DurationSeconds,
	).Scan(&log.ID, &log.CreatedAt)
	if err != nil {
		return fmt.Errorf("moderation log action: %w", err)
	}
	return nil
}

func (r *ModerationRepository) ListLogs(ctx context.Context, guildID string, limit int) ([]model.ModerationLog, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, guild_id, moderator_id, target_id, action, reason, duration_seconds, created_at
		 FROM moderation_logs WHERE guild_id = $1
		 ORDER BY created_at DESC LIMIT $2`,
		guildID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("moderation list logs: %w", err)
	}
	defer rows.Close()

	var logs []model.ModerationLog
	for rows.Next() {
		var l model.ModerationLog
		if err := rows.Scan(&l.ID, &l.GuildID, &l.ModeratorID, &l.TargetID,
			&l.Action, &l.Reason, &l.DurationSeconds, &l.CreatedAt); err != nil {
			return nil, fmt.Errorf("moderation list logs scan: %w", err)
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}
