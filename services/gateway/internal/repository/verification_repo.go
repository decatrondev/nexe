package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/decatrondev/nexe/services/gateway/internal/model"
)

type VerificationRepository struct {
	db *sql.DB
}

func NewVerificationRepository(db *sql.DB) *VerificationRepository {
	return &VerificationRepository{db: db}
}

func (r *VerificationRepository) Create(ctx context.Context, email, code string, expiresAt time.Time) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO email_verification (email, code, expires_at)
		VALUES ($1, $2, $3)`, email, code, expiresAt)
	return err
}

func (r *VerificationRepository) GetLatest(ctx context.Context, email string) (*model.EmailVerification, error) {
	v := &model.EmailVerification{}
	err := r.db.QueryRowContext(ctx, `
		SELECT id, email, code, attempts, expires_at, used
		FROM email_verification
		WHERE email = $1 AND used = false AND expires_at > NOW()
		ORDER BY created_at DESC LIMIT 1`, email,
	).Scan(&v.ID, &v.Email, &v.Code, &v.Attempts, &v.ExpiresAt, &v.Used)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get verification: %w", err)
	}
	return v, nil
}

func (r *VerificationRepository) IncrementAttempts(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE email_verification SET attempts = attempts + 1 WHERE id = $1`, id)
	return err
}

func (r *VerificationRepository) MarkUsed(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE email_verification SET used = true WHERE id = $1`, id)
	return err
}
