package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/decatrondev/nexe/services/gateway/internal/model"
)

type UserRepository struct {
	db *sql.DB
}

func NewUserRepository(db *sql.DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) Create(ctx context.Context, user *model.User) error {
	query := `
		INSERT INTO users (username, email, password_hash, email_verified, status)
		VALUES ($1, $2, $3, $4, 'offline')
		RETURNING id, created_at, updated_at`

	return r.db.QueryRowContext(ctx, query,
		user.Username, user.Email, user.PasswordHash, user.EmailVerified,
	).Scan(&user.ID, &user.CreatedAt, &user.UpdatedAt)
}

func (r *UserRepository) GetByID(ctx context.Context, id string) (*model.User, error) {
	return r.scanUser(r.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, u.email, u.email_verified, u.password_hash,
		       u.twitch_id, u.twitch_login, u.twitch_display_name,
		       u.status, u.custom_status_text, u.custom_status_emoji,
		       COALESCE(ut.tier, 'free'), u.flags, u.disabled, u.created_at, u.updated_at
		FROM users u
		LEFT JOIN user_tiers ut ON ut.user_id = u.id
		WHERE u.id = $1 AND u.disabled = false`, id))
}

func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*model.User, error) {
	return r.scanUser(r.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, u.email, u.email_verified, u.password_hash,
		       u.twitch_id, u.twitch_login, u.twitch_display_name,
		       u.status, u.custom_status_text, u.custom_status_emoji,
		       COALESCE(ut.tier, 'free'), u.flags, u.disabled, u.created_at, u.updated_at
		FROM users u
		LEFT JOIN user_tiers ut ON ut.user_id = u.id
		WHERE u.email = $1`, email))
}

func (r *UserRepository) GetByUsername(ctx context.Context, username string) (*model.User, error) {
	return r.scanUser(r.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, u.email, u.email_verified, u.password_hash,
		       u.twitch_id, u.twitch_login, u.twitch_display_name,
		       u.status, u.custom_status_text, u.custom_status_emoji,
		       COALESCE(ut.tier, 'free'), u.flags, u.disabled, u.created_at, u.updated_at
		FROM users u
		LEFT JOIN user_tiers ut ON ut.user_id = u.id
		WHERE u.username = $1`, username))
}

func (r *UserRepository) GetByTwitchID(ctx context.Context, twitchID string) (*model.User, error) {
	return r.scanUser(r.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, u.email, u.email_verified, u.password_hash,
		       u.twitch_id, u.twitch_login, u.twitch_display_name,
		       u.status, u.custom_status_text, u.custom_status_emoji,
		       COALESCE(ut.tier, 'free'), u.flags, u.disabled, u.created_at, u.updated_at
		FROM users u
		LEFT JOIN user_tiers ut ON ut.user_id = u.id
		WHERE u.twitch_id = $1`, twitchID))
}

func (r *UserRepository) VerifyEmail(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = $1`, userID)
	return err
}

func (r *UserRepository) CreateProfile(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, userID)
	return err
}

func (r *UserRepository) CreateTier(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO user_tiers (user_id, tier) VALUES ($1, 'free') ON CONFLICT DO NOTHING`, userID)
	return err
}

func (r *UserRepository) scanUser(row *sql.Row) (*model.User, error) {
	u := &model.User{}
	err := row.Scan(
		&u.ID, &u.Username, &u.Email, &u.EmailVerified, &u.PasswordHash,
		&u.TwitchID, &u.TwitchLogin, &u.TwitchDisplayName,
		&u.Status, &u.CustomStatusText, &u.CustomStatusEmoji,
		&u.Tier, &u.Flags, &u.Disabled, &u.CreatedAt, &u.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan user: %w", err)
	}
	return u, nil
}
