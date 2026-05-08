package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/decatrondev/nexe/services/gateway/internal/model"
)

type SessionRepository struct {
	db *sql.DB
}

func NewSessionRepository(db *sql.DB) *SessionRepository {
	return &SessionRepository{db: db}
}

func (r *SessionRepository) Create(ctx context.Context, sess *model.Session) error {
	query := `
		INSERT INTO sessions (user_id, refresh_token_hash, device_name, ip_address, user_agent, expires_at)
		VALUES ($1, $2, $3, $4::inet, $5, $6)
		RETURNING id, created_at, last_used_at`

	return r.db.QueryRowContext(ctx, query,
		sess.UserID, sess.RefreshTokenHash, sess.DeviceName,
		sess.IPAddress, sess.UserAgent, sess.ExpiresAt,
	).Scan(&sess.ID, &sess.CreatedAt, &sess.LastUsedAt)
}

func (r *SessionRepository) GetByID(ctx context.Context, id string) (*model.Session, error) {
	s := &model.Session{}
	err := r.db.QueryRowContext(ctx, `
		SELECT id, user_id, refresh_token_hash, device_name, ip_address::text, user_agent,
		       last_used_at, expires_at, created_at
		FROM sessions WHERE id = $1 AND expires_at > NOW()`, id,
	).Scan(&s.ID, &s.UserID, &s.RefreshTokenHash, &s.DeviceName,
		&s.IPAddress, &s.UserAgent, &s.LastUsedAt, &s.ExpiresAt, &s.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	return s, nil
}

func (r *SessionRepository) ListByUser(ctx context.Context, userID string) ([]model.Session, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, user_id, device_name, ip_address::text, user_agent,
		       last_used_at, expires_at, created_at
		FROM sessions WHERE user_id = $1 AND expires_at > NOW()
		ORDER BY last_used_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	var sessions []model.Session
	for rows.Next() {
		s := model.Session{}
		if err := rows.Scan(&s.ID, &s.UserID, &s.DeviceName, &s.IPAddress,
			&s.UserAgent, &s.LastUsedAt, &s.ExpiresAt, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		sessions = append(sessions, s)
	}
	return sessions, nil
}

func (r *SessionRepository) Touch(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE sessions SET last_used_at = NOW() WHERE id = $1`, id)
	return err
}

func (r *SessionRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM sessions WHERE id = $1`, id)
	return err
}

func (r *SessionRepository) DeleteAllByUser(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM sessions WHERE user_id = $1`, userID)
	return err
}

func (r *SessionRepository) DeleteExpired(ctx context.Context) (int64, error) {
	result, err := r.db.ExecContext(ctx,
		`DELETE FROM sessions WHERE expires_at < $1`, time.Now())
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
