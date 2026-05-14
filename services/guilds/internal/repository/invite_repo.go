package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/decatrondev/nexe/services/guilds/internal/model"
)

type InviteRepository struct {
	db *sql.DB
}

func NewInviteRepository(db *sql.DB) *InviteRepository {
	return &InviteRepository{db: db}
}

func (r *InviteRepository) Create(ctx context.Context, inv *model.Invite) error {
	err := r.db.QueryRowContext(ctx,
		`INSERT INTO invites (code, guild_id, channel_id, inviter_id, max_uses, max_age_seconds, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING created_at`,
		inv.Code, inv.GuildID, inv.ChannelID, inv.InviterID,
		inv.MaxUses, nil, inv.ExpiresAt,
	).Scan(&inv.CreatedAt)
	if err != nil {
		return fmt.Errorf("invite create: %w", err)
	}
	return nil
}

func (r *InviteRepository) GetByCode(ctx context.Context, code string) (*model.Invite, error) {
	var inv model.Invite
	err := r.db.QueryRowContext(ctx,
		`SELECT code, guild_id, channel_id, inviter_id, max_uses, uses, expires_at, created_at
		 FROM invites WHERE code = $1`, code,
	).Scan(&inv.Code, &inv.GuildID, &inv.ChannelID, &inv.InviterID,
		&inv.MaxUses, &inv.Uses, &inv.ExpiresAt, &inv.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("invite get by code: %w", err)
	}
	return &inv, nil
}

func (r *InviteRepository) ListByGuild(ctx context.Context, guildID string) ([]model.Invite, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT code, guild_id, channel_id, inviter_id, max_uses, uses, expires_at, created_at
		 FROM invites WHERE guild_id = $1
		 AND (expires_at IS NULL OR expires_at > NOW())
		 ORDER BY created_at DESC`, guildID,
	)
	if err != nil {
		return nil, fmt.Errorf("invite list by guild: %w", err)
	}
	defer rows.Close()

	var invites []model.Invite
	for rows.Next() {
		var inv model.Invite
		if err := rows.Scan(&inv.Code, &inv.GuildID, &inv.ChannelID, &inv.InviterID,
			&inv.MaxUses, &inv.Uses, &inv.ExpiresAt, &inv.CreatedAt); err != nil {
			return nil, fmt.Errorf("invite list by guild scan: %w", err)
		}
		invites = append(invites, inv)
	}
	return invites, rows.Err()
}

func (r *InviteRepository) Delete(ctx context.Context, code string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM invites WHERE code = $1`, code)
	if err != nil {
		return fmt.Errorf("invite delete: %w", err)
	}
	return nil
}

func (r *InviteRepository) DeleteExpired(ctx context.Context) (int64, error) {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM invites WHERE expires_at IS NOT NULL AND expires_at <= NOW()`)
	if err != nil {
		return 0, fmt.Errorf("invite delete expired: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (r *InviteRepository) IncrementUses(ctx context.Context, code string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE invites SET uses = uses + 1 WHERE code = $1`, code,
	)
	if err != nil {
		return fmt.Errorf("invite increment uses: %w", err)
	}
	return nil
}
