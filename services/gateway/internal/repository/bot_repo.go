package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/decatrondev/nexe/services/gateway/internal/model"
	"github.com/lib/pq"
)

type BotRepository struct {
	db *sql.DB
}

func NewBotRepository(db *sql.DB) *BotRepository {
	return &BotRepository{db: db}
}

func (r *BotRepository) Create(ctx context.Context, app *model.BotApplication) error {
	query := `
		INSERT INTO bot_applications (owner_id, name, description, icon_url, client_id, client_secret_hash, redirect_uris, scopes, public)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, created_at, updated_at`

	return r.db.QueryRowContext(ctx, query,
		app.OwnerID, app.Name, app.Description, app.IconUrl,
		app.ClientID, app.ClientSecret, // ClientSecret field reused for hash
		pq.Array(app.RedirectURIs), pq.Array(app.Scopes), app.Public,
	).Scan(&app.ID, &app.CreatedAt, &app.UpdatedAt)
}

func (r *BotRepository) GetByID(ctx context.Context, id string) (*model.BotApplication, error) {
	app := &model.BotApplication{}
	err := r.db.QueryRowContext(ctx, `
		SELECT id, owner_id, name, description, icon_url, client_id,
		       redirect_uris, scopes, bot_user_id, public, created_at, updated_at
		FROM bot_applications WHERE id = $1`, id,
	).Scan(&app.ID, &app.OwnerID, &app.Name, &app.Description, &app.IconUrl,
		&app.ClientID, pq.Array(&app.RedirectURIs), pq.Array(&app.Scopes),
		&app.BotUserID, &app.Public, &app.CreatedAt, &app.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get bot app: %w", err)
	}
	return app, nil
}

func (r *BotRepository) GetByClientID(ctx context.Context, clientID string) (*model.BotApplication, string, error) {
	app := &model.BotApplication{}
	var secretHash string
	err := r.db.QueryRowContext(ctx, `
		SELECT id, owner_id, name, description, icon_url, client_id, client_secret_hash,
		       redirect_uris, scopes, bot_user_id, public, created_at, updated_at
		FROM bot_applications WHERE client_id = $1`, clientID,
	).Scan(&app.ID, &app.OwnerID, &app.Name, &app.Description, &app.IconUrl,
		&app.ClientID, &secretHash, pq.Array(&app.RedirectURIs), pq.Array(&app.Scopes),
		&app.BotUserID, &app.Public, &app.CreatedAt, &app.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", fmt.Errorf("get bot by client: %w", err)
	}
	return app, secretHash, nil
}

func (r *BotRepository) ListByOwner(ctx context.Context, ownerID string) ([]model.BotApplication, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, owner_id, name, description, icon_url, client_id,
		       redirect_uris, scopes, bot_user_id, public, created_at, updated_at
		FROM bot_applications WHERE owner_id = $1
		ORDER BY created_at DESC`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list bot apps: %w", err)
	}
	defer rows.Close()

	var apps []model.BotApplication
	for rows.Next() {
		app := model.BotApplication{}
		if err := rows.Scan(&app.ID, &app.OwnerID, &app.Name, &app.Description, &app.IconUrl,
			&app.ClientID, pq.Array(&app.RedirectURIs), pq.Array(&app.Scopes),
			&app.BotUserID, &app.Public, &app.CreatedAt, &app.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan bot app: %w", err)
		}
		apps = append(apps, app)
	}
	return apps, nil
}

func (r *BotRepository) Update(ctx context.Context, id string, name string, description *string, redirectURIs, scopes []string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE bot_applications SET name = $2, description = $3, redirect_uris = $4, scopes = $5, updated_at = NOW()
		WHERE id = $1`, id, name, description, pq.Array(redirectURIs), pq.Array(scopes))
	return err
}

func (r *BotRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM bot_applications WHERE id = $1`, id)
	return err
}

func (r *BotRepository) ResetSecret(ctx context.Context, id, newSecretHash string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE bot_applications SET client_secret_hash = $2, updated_at = NOW()
		WHERE id = $1`, id, newSecretHash)
	return err
}
