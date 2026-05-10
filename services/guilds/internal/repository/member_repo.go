package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/lib/pq"

	"github.com/decatrondev/nexe/services/guilds/internal/model"
)

type MemberRepository struct {
	db *sql.DB
}

func NewMemberRepository(db *sql.DB) *MemberRepository {
	return &MemberRepository{db: db}
}

func (r *MemberRepository) Add(ctx context.Context, guildID, userID string) (*model.GuildMember, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("member add begin tx: %w", err)
	}
	defer tx.Rollback()

	var member model.GuildMember
	err = tx.QueryRowContext(ctx,
		`INSERT INTO guild_members (guild_id, user_id)
		 VALUES ($1, $2)
		 RETURNING id, guild_id, user_id, nickname, joined_at, muted, muted_until`,
		guildID, userID,
	).Scan(&member.ID, &member.GuildID, &member.UserID, &member.Nickname,
		&member.JoinedAt, &member.Muted, &member.MutedUntil)
	if err != nil {
		return nil, fmt.Errorf("member add insert: %w", err)
	}

	// Assign @everyone role
	_, err = tx.ExecContext(ctx,
		`INSERT INTO member_roles (member_id, role_id)
		 SELECT $1, r.id FROM roles r
		 WHERE r.guild_id = $2 AND r.is_default = true`,
		member.ID, guildID,
	)
	if err != nil {
		return nil, fmt.Errorf("member add assign everyone role: %w", err)
	}

	// Increment member count
	_, err = tx.ExecContext(ctx,
		`UPDATE guilds SET member_count = member_count + 1 WHERE id = $1`, guildID,
	)
	if err != nil {
		return nil, fmt.Errorf("member add increment count: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("member add commit: %w", err)
	}

	return &member, nil
}

func (r *MemberRepository) Remove(ctx context.Context, guildID, userID string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("member remove begin tx: %w", err)
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx,
		`DELETE FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
		guildID, userID,
	)
	if err != nil {
		return fmt.Errorf("member remove delete: %w", err)
	}

	_, err = tx.ExecContext(ctx,
		`UPDATE guilds SET member_count = GREATEST(member_count - 1, 0) WHERE id = $1`, guildID,
	)
	if err != nil {
		return fmt.Errorf("member remove decrement count: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("member remove commit: %w", err)
	}

	return nil
}

func (r *MemberRepository) GetByGuildAndUser(ctx context.Context, guildID, userID string) (*model.GuildMember, error) {
	var m model.GuildMember
	err := r.db.QueryRowContext(ctx,
		`SELECT id, guild_id, user_id, nickname, joined_at, muted, muted_until
		 FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
		guildID, userID,
	).Scan(&m.ID, &m.GuildID, &m.UserID, &m.Nickname, &m.JoinedAt, &m.Muted, &m.MutedUntil)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("member get by guild and user: %w", err)
	}
	return &m, nil
}

func (r *MemberRepository) ListByGuild(ctx context.Context, guildID string, limit, offset int) ([]model.GuildMember, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT gm.id, gm.guild_id, gm.user_id, gm.nickname, gm.joined_at, gm.muted, gm.muted_until,
		        COALESCE(array_agg(mr.role_id) FILTER (WHERE mr.role_id IS NOT NULL), '{}')
		 FROM guild_members gm
		 LEFT JOIN member_roles mr ON mr.member_id = gm.id
		 WHERE gm.guild_id = $1
		 GROUP BY gm.id, gm.guild_id, gm.user_id, gm.nickname, gm.joined_at, gm.muted, gm.muted_until
		 ORDER BY gm.joined_at
		 LIMIT $2 OFFSET $3`,
		guildID, limit, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("member list by guild: %w", err)
	}
	defer rows.Close()

	var members []model.GuildMember
	for rows.Next() {
		var m model.GuildMember
		var roleIds pq.StringArray
		if err := rows.Scan(&m.ID, &m.GuildID, &m.UserID, &m.Nickname,
			&m.JoinedAt, &m.Muted, &m.MutedUntil, &roleIds); err != nil {
			return nil, fmt.Errorf("member list by guild scan: %w", err)
		}
		m.RoleIds = roleIds
		members = append(members, m)
	}
	return members, rows.Err()
}

func (r *MemberRepository) GetMemberPermissions(ctx context.Context, memberID, guildID string) (int64, error) {
	var perms sql.NullInt64
	err := r.db.QueryRowContext(ctx,
		`SELECT BIT_OR(r.permissions)
		 FROM roles r
		 JOIN member_roles mr ON mr.role_id = r.id
		 WHERE mr.member_id = $1 AND r.guild_id = $2`,
		memberID, guildID,
	).Scan(&perms)
	if err != nil {
		return 0, fmt.Errorf("member get permissions: %w", err)
	}
	return perms.Int64, nil
}

func (r *MemberRepository) AssignRole(ctx context.Context, memberID, roleID, assignedBy string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO member_roles (member_id, role_id, assigned_by)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (member_id, role_id) DO NOTHING`,
		memberID, roleID, assignedBy,
	)
	if err != nil {
		return fmt.Errorf("member assign role: %w", err)
	}
	return nil
}

func (r *MemberRepository) RemoveRole(ctx context.Context, memberID, roleID string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM member_roles WHERE member_id = $1 AND role_id = $2`,
		memberID, roleID,
	)
	if err != nil {
		return fmt.Errorf("member remove role: %w", err)
	}
	return nil
}

func (r *MemberRepository) GetMemberRoles(ctx context.Context, memberID string) ([]model.Role, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT r.id, r.guild_id, r.name, r.color, r.position, r.permissions,
		        r.mentionable, r.hoisted, r.is_default, r.is_auto, r.auto_source,
		        r.created_at, r.updated_at
		 FROM roles r
		 JOIN member_roles mr ON mr.role_id = r.id
		 WHERE mr.member_id = $1
		 ORDER BY r.position`, memberID,
	)
	if err != nil {
		return nil, fmt.Errorf("member get roles: %w", err)
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
			return nil, fmt.Errorf("member get roles scan: %w", err)
		}
		roles = append(roles, role)
	}
	return roles, rows.Err()
}
