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
	err := r.db.QueryRowContext(ctx,
		`UPDATE roles
		 SET name = $1, color = $2, position = $3, permissions = $4,
		     mentionable = $5, hoisted = $6, is_default = $7, updated_at = NOW()
		 WHERE id = $8
		 RETURNING id, guild_id, name, color, position, permissions, mentionable,
		           hoisted, is_default, is_auto, created_at, updated_at`,
		role.Name, role.Color, role.Position, role.Permissions,
		role.Mentionable, role.Hoisted, role.IsDefault, role.ID,
	).Scan(
		&role.ID, &role.GuildID, &role.Name, &role.Color, &role.Position,
		&role.Permissions, &role.Mentionable, &role.Hoisted, &role.IsDefault,
		&role.IsAuto, &role.CreatedAt, &role.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("role update: %w", err)
	}
	return nil
}

func (r *RoleRepository) CountByGuild(ctx context.Context, guildID string) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM roles WHERE guild_id = $1`, guildID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("role count by guild: %w", err)
	}
	return count, nil
}

func (r *RoleRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM roles WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("role delete: %w", err)
	}
	return nil
}

func (r *RoleRepository) GetAutoRoleBySource(ctx context.Context, guildID, autoSource string) (*model.Role, error) {
	var role model.Role
	err := r.db.QueryRowContext(ctx,
		`SELECT id, guild_id, name, color, position, permissions, mentionable,
		        hoisted, is_default, is_auto, auto_source, created_at, updated_at
		 FROM roles WHERE guild_id = $1 AND is_auto = true AND auto_source = $2`, guildID, autoSource,
	).Scan(
		&role.ID, &role.GuildID, &role.Name, &role.Color, &role.Position, &role.Permissions,
		&role.Mentionable, &role.Hoisted, &role.IsDefault, &role.IsAuto, &role.AutoSource,
		&role.CreatedAt, &role.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("role get auto by source: %w", err)
	}
	return &role, nil
}

func (r *RoleRepository) DeleteAutoRolesByGuild(ctx context.Context, guildID string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM roles WHERE guild_id = $1 AND is_auto = true`, guildID)
	if err != nil {
		return fmt.Errorf("role delete auto by guild: %w", err)
	}
	return nil
}

func (r *RoleRepository) ListAutoRolesByGuild(ctx context.Context, guildID string) ([]model.Role, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, guild_id, name, color, position, permissions, mentionable,
		        hoisted, is_default, is_auto, auto_source, created_at, updated_at
		 FROM roles WHERE guild_id = $1 AND is_auto = true ORDER BY position`, guildID,
	)
	if err != nil {
		return nil, fmt.Errorf("role list auto by guild: %w", err)
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
			return nil, fmt.Errorf("role list auto by guild scan: %w", err)
		}
		roles = append(roles, role)
	}
	return roles, rows.Err()
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
