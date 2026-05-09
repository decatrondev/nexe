package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/decatrondev/nexe/services/guilds/internal/model"
)

type RoleRepository struct {
	db *sql.DB
}

func NewRoleRepository(db *sql.DB) *RoleRepository {
	return &RoleRepository{db: db}
}

func (r *RoleRepository) Create(ctx context.Context, role *model.Role) error {
	err := r.db.QueryRowContext(ctx,
		`INSERT INTO roles (guild_id, name, color, position, permissions, mentionable, hoisted, is_default, is_auto, auto_source)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 RETURNING id, created_at, updated_at`,
		role.GuildID, role.Name, role.Color, role.Position, role.Permissions,
		role.Mentionable, role.Hoisted, role.IsDefault, role.IsAuto, role.AutoSource,
	).Scan(&role.ID, &role.CreatedAt, &role.UpdatedAt)
	if err != nil {
		return fmt.Errorf("role create: %w", err)
	}
	return nil
}

func (r *RoleRepository) GetByID(ctx context.Context, id string) (*model.Role, error) {
	var role model.Role
	err := r.db.QueryRowContext(ctx,
		`SELECT id, guild_id, name, color, position, permissions, mentionable,
		        hoisted, is_default, is_auto, auto_source, created_at, updated_at
		 FROM roles WHERE id = $1`, id,
	).Scan(
		&role.ID, &role.GuildID, &role.Name, &role.Color, &role.Position, &role.Permissions,
		&role.Mentionable, &role.Hoisted, &role.IsDefault, &role.IsAuto, &role.AutoSource,
		&role.CreatedAt, &role.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("role get by id: %w", err)
	}
	return &role, nil
}

func (r *RoleRepository) ListByGuild(ctx context.Context, guildID string) ([]model.Role, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, guild_id, name, color, position, permissions, mentionable,
		        hoisted, is_default, is_auto, auto_source, created_at, updated_at
		 FROM roles WHERE guild_id = $1 ORDER BY position`, guildID,
	)
	if err != nil {
		return nil, fmt.Errorf("role list by guild: %w", err)
	}
	defer rows.Close()

	var roles []model.Role
	for rows.Next() {
		var role model.Role
		if err := rows.Scan(
			&role.ID, &role.GuildID, &role.Name, &role.Color, &role.Position, &role.Permissions,
			&role.Mentionable, &role.Hoisted, &role.IsDefault, &role.IsAuto, &role.AutoSource,
			&role.CreatedAt, &role.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("role list by guild scan: %w", err)
		}
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

func (r *RoleRepository) Update(ctx context.Context, role *model.Role) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE roles
		 SET name = $1, color = $2, position = $3, permissions = $4,
		     mentionable = $5, hoisted = $6, is_default = $7, updated_at = NOW()
		 WHERE id = $8`,
		role.Name, role.Color, role.Position, role.Permissions,
		role.Mentionable, role.Hoisted, role.IsDefault, role.ID,
	)
	if err != nil {
		return fmt.Errorf("role update: %w", err)
	}
	return nil
}

func (r *RoleRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM roles WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("role delete: %w", err)
	}
	return nil
}

func (r *RoleRepository) GetDefaultRole(ctx context.Context, guildID string) (*model.Role, error) {
	var role model.Role
	err := r.db.QueryRowContext(ctx,
		`SELECT id, guild_id, name, color, position, permissions, mentionable,
		        hoisted, is_default, is_auto, auto_source, created_at, updated_at
		 FROM roles WHERE guild_id = $1 AND is_default = true`, guildID,
	).Scan(
		&role.ID, &role.GuildID, &role.Name, &role.Color, &role.Position, &role.Permissions,
		&role.Mentionable, &role.Hoisted, &role.IsDefault, &role.IsAuto, &role.AutoSource,
		&role.CreatedAt, &role.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("role get default: %w", err)
	}
	return &role, nil
}
