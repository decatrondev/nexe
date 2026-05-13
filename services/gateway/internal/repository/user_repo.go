package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/decatrondev/nexe/services/gateway/internal/model"
	"golang.org/x/crypto/bcrypt"
)

type UserRepository struct {
	db *sql.DB
}

func NewUserRepository(db *sql.DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) Create(ctx context.Context, user *model.User) error {
	query := `
		INSERT INTO users (username, email, password_hash, email_verified, status, twitch_id, twitch_login)
		VALUES ($1, $2, $3, $4, 'offline', $5, $6)
		RETURNING id, created_at, updated_at`

	return r.db.QueryRowContext(ctx, query,
		user.Username, user.Email, user.PasswordHash, user.EmailVerified,
		user.TwitchID, user.TwitchLogin,
	).Scan(&user.ID, &user.CreatedAt, &user.UpdatedAt)
}

func (r *UserRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM profiles WHERE user_id = $1`, id)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = $1`, id)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, id)
	return err
}

func (r *UserRepository) GetByID(ctx context.Context, id string) (*model.User, error) {
	return r.scanUser(r.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, u.email, u.email_verified, u.password_hash,
		       u.twitch_id, u.twitch_login, u.twitch_display_name,
		       u.twitch_access_token, u.twitch_refresh_token, u.twitch_token_expires_at,
		       u.status, u.custom_status_text, u.custom_status_emoji,
		       COALESCE(ut.tier, 'free'), u.flags, u.disabled, u.totp_secret, COALESCE(u.totp_enabled, false), u.created_at, u.updated_at
		FROM users u
		LEFT JOIN user_tiers ut ON ut.user_id = u.id
		WHERE u.id = $1 AND u.disabled = false`, id))
}

func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*model.User, error) {
	return r.scanUser(r.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, u.email, u.email_verified, u.password_hash,
		       u.twitch_id, u.twitch_login, u.twitch_display_name,
		       u.twitch_access_token, u.twitch_refresh_token, u.twitch_token_expires_at,
		       u.status, u.custom_status_text, u.custom_status_emoji,
		       COALESCE(ut.tier, 'free'), u.flags, u.disabled, u.totp_secret, COALESCE(u.totp_enabled, false), u.created_at, u.updated_at
		FROM users u
		LEFT JOIN user_tiers ut ON ut.user_id = u.id
		WHERE u.email = $1`, email))
}

func (r *UserRepository) GetByUsername(ctx context.Context, username string) (*model.User, error) {
	return r.scanUser(r.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, u.email, u.email_verified, u.password_hash,
		       u.twitch_id, u.twitch_login, u.twitch_display_name,
		       u.twitch_access_token, u.twitch_refresh_token, u.twitch_token_expires_at,
		       u.status, u.custom_status_text, u.custom_status_emoji,
		       COALESCE(ut.tier, 'free'), u.flags, u.disabled, u.totp_secret, COALESCE(u.totp_enabled, false), u.created_at, u.updated_at
		FROM users u
		LEFT JOIN user_tiers ut ON ut.user_id = u.id
		WHERE u.username = $1`, username))
}

func (r *UserRepository) GetByTwitchID(ctx context.Context, twitchID string) (*model.User, error) {
	return r.scanUser(r.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, u.email, u.email_verified, u.password_hash,
		       u.twitch_id, u.twitch_login, u.twitch_display_name,
		       u.twitch_access_token, u.twitch_refresh_token, u.twitch_token_expires_at,
		       u.status, u.custom_status_text, u.custom_status_emoji,
		       COALESCE(ut.tier, 'free'), u.flags, u.disabled, u.totp_secret, COALESCE(u.totp_enabled, false), u.created_at, u.updated_at
		FROM users u
		LEFT JOIN user_tiers ut ON ut.user_id = u.id
		WHERE u.twitch_id = $1`, twitchID))
}

// GetAllTwitchIDs returns all non-empty twitch_id values from the users table.
func (r *UserRepository) GetAllTwitchIDs(ctx context.Context) ([]string, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT twitch_id FROM users WHERE twitch_id IS NOT NULL AND twitch_id != ''`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	return ids, rows.Err()
}

func (r *UserRepository) VerifyEmail(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = $1`, userID)
	return err
}

func (r *UserRepository) UpdatePassword(ctx context.Context, email, passwordHash string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE email = $1`, email, passwordHash)
	return err
}

func (r *UserRepository) LinkTwitch(ctx context.Context, userID, twitchID, twitchLogin, twitchDisplayName, accessToken, refreshToken string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE users SET
			twitch_id = $2, twitch_login = $3, twitch_display_name = $4,
			twitch_access_token = $5, twitch_refresh_token = $6,
			twitch_token_expires_at = NOW() + INTERVAL '4 hours',
			updated_at = NOW()
		WHERE id = $1`, userID, twitchID, twitchLogin, twitchDisplayName, accessToken, refreshToken)
	return err
}

func (r *UserRepository) UnlinkTwitch(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE users SET
			twitch_id = NULL, twitch_login = NULL, twitch_display_name = NULL,
			twitch_access_token = NULL, twitch_refresh_token = NULL,
			twitch_token_expires_at = NULL,
			updated_at = NOW()
		WHERE id = $1`, userID)
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
		&u.TwitchAccessToken, &u.TwitchRefreshToken, &u.TwitchTokenExpiresAt,
		&u.Status, &u.CustomStatusText, &u.CustomStatusEmoji,
		&u.Tier, &u.Flags, &u.Disabled, &u.TOTPSecret, &u.TOTPEnabled, &u.CreatedAt, &u.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan user: %w", err)
	}
	return u, nil
}

// ── TOTP / 2FA ──

func (r *UserRepository) SetTOTPSecret(ctx context.Context, userID, secret string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET totp_secret = $1 WHERE id = $2`, secret, userID)
	return err
}

func (r *UserRepository) EnableTOTP(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET totp_enabled = true WHERE id = $1`, userID)
	return err
}

func (r *UserRepository) DisableTOTP(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = $1`, userID)
	return err
}

func (r *UserRepository) SaveRecoveryCodes(ctx context.Context, userID string, codes []string) error {
	_, _ = r.db.ExecContext(ctx, `DELETE FROM recovery_codes WHERE user_id = $1`, userID)
	for _, code := range codes {
		hash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
		if err != nil {
			return fmt.Errorf("hash recovery code: %w", err)
		}
		_, err = r.db.ExecContext(ctx,
			`INSERT INTO recovery_codes (user_id, code) VALUES ($1, $2)`, userID, string(hash))
		if err != nil {
			return err
		}
	}
	return nil
}

func (r *UserRepository) UseRecoveryCode(ctx context.Context, userID, code string) (bool, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, code FROM recovery_codes WHERE user_id = $1 AND used = false`, userID)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var id, hash string
		if err := rows.Scan(&id, &hash); err != nil {
			return false, err
		}
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(code)) == nil {
			_, err := r.db.ExecContext(ctx,
				`UPDATE recovery_codes SET used = true WHERE id = $1`, id)
			return err == nil, err
		}
	}
	return false, nil
}
