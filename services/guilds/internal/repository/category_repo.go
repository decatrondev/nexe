package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/decatrondev/nexe/services/guilds/internal/model"
)

type CategoryRepository struct {
	db *sql.DB
}

func NewCategoryRepository(db *sql.DB) *CategoryRepository {
	return &CategoryRepository{db: db}
}

func (r *CategoryRepository) Create(ctx context.Context, cat *model.Category) error {
	err := r.db.QueryRowContext(ctx,
		`INSERT INTO categories (guild_id, name, position)
		 VALUES ($1, $2, $3)
		 RETURNING id, created_at`,
		cat.GuildID, cat.Name, cat.Position,
	).Scan(&cat.ID, &cat.CreatedAt)
	if err != nil {
		return fmt.Errorf("category create: %w", err)
	}
	return nil
}

func (r *CategoryRepository) ListByGuild(ctx context.Context, guildID string) ([]model.Category, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, guild_id, name, position, created_at
		 FROM categories WHERE guild_id = $1 ORDER BY position`, guildID,
	)
	if err != nil {
		return nil, fmt.Errorf("category list by guild: %w", err)
	}
	defer rows.Close()

	var categories []model.Category
	for rows.Next() {
		var cat model.Category
		if err := rows.Scan(&cat.ID, &cat.GuildID, &cat.Name, &cat.Position, &cat.CreatedAt); err != nil {
			return nil, fmt.Errorf("category list by guild scan: %w", err)
		}
		categories = append(categories, cat)
	}
	return categories, rows.Err()
}

func (r *CategoryRepository) Update(ctx context.Context, cat *model.Category) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE categories SET name = $1, position = $2 WHERE id = $3`,
		cat.Name, cat.Position, cat.ID,
	)
	if err != nil {
		return fmt.Errorf("category update: %w", err)
	}
	return nil
}

func (r *CategoryRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM categories WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("category delete: %w", err)
	}
	return nil
}
