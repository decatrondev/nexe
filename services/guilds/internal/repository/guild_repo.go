package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/decatrondev/nexe/services/guilds/internal/model"
)

// DefaultEveryonePermissions is the default permission set for the @everyone role.
const DefaultEveryonePermissions int64 = 0x00000001 | // VIEW_CHANNELS
	0x00000800 | // SEND_MESSAGES
	0x00004000 | // EMBED_LINKS
	0x00008000 | // ATTACH_FILES
	0x00010000 | // READ_MESSAGE_HISTORY
	0x00100000 | // CONNECT (voice)
	0x00200000 | // SPEAK (voice)
	0x02000000 // CHANGE_NICKNAME

type GuildRepository struct {
	db *sql.DB
}

func NewGuildRepository(db *sql.DB) *GuildRepository {
	return &GuildRepository{db: db}
}

func (r *GuildRepository) Create(ctx context.Context, guild *model.Guild) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("guild create begin tx: %w", err)
	}
	defer tx.Rollback()

	err = tx.QueryRowContext(ctx,
		`INSERT INTO guilds (name, description, icon_url, banner_url, owner_id, is_streamer_server, member_count)
		 VALUES ($1, $2, $3, $4, $5, $6, 1)
		 RETURNING id, created_at, updated_at`,
		guild.Name, guild.Description, guild.IconUrl, guild.BannerUrl, guild.OwnerID, guild.IsStreamerServer,
	).Scan(&guild.ID, &guild.CreatedAt, &guild.UpdatedAt)
	if err != nil {
		return fmt.Errorf("guild create insert: %w", err)
	}

	guild.MemberCount = 1

	_, err = tx.ExecContext(ctx,
		`INSERT INTO roles (guild_id, name, is_default, position, permissions)
		 VALUES ($1, '@everyone', true, 0, $2)`,
		guild.ID, DefaultEveryonePermissions,
	)
	if err != nil {
		return fmt.Errorf("guild create everyone role: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("guild create commit: %w", err)
	}

	return nil
}

func (r *GuildRepository) GetByID(ctx context.Context, id string) (*model.Guild, error) {
	var g model.Guild
	err := r.db.QueryRowContext(ctx,
		`SELECT id, name, description, icon_url, banner_url, owner_id,
		        is_streamer_server, member_count, features, created_at, updated_at
		 FROM guilds WHERE id = $1`, id,
	).Scan(
		&g.ID, &g.Name, &g.Description, &g.IconUrl, &g.BannerUrl, &g.OwnerID,
		&g.IsStreamerServer, &g.MemberCount, pqJSONArray(&g.Features), &g.CreatedAt, &g.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("guild get by id: %w", err)
	}
	return &g, nil
}

func (r *GuildRepository) Update(ctx context.Context, guild *model.Guild) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE guilds
		 SET name = $1, description = $2, icon_url = $3, banner_url = $4,
		     is_streamer_server = $5, updated_at = NOW()
		 WHERE id = $6`,
		guild.Name, guild.Description, guild.IconUrl, guild.BannerUrl,
		guild.IsStreamerServer, guild.ID,
	)
	if err != nil {
		return fmt.Errorf("guild update: %w", err)
	}
	return nil
}

func (r *GuildRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM guilds WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("guild delete: %w", err)
	}
	return nil
}

func (r *GuildRepository) ListByUser(ctx context.Context, userID string) ([]model.Guild, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT g.id, g.name, g.description, g.icon_url, g.banner_url, g.owner_id,
		        g.is_streamer_server, g.member_count, g.features, g.created_at, g.updated_at
		 FROM guilds g
		 JOIN guild_members gm ON gm.guild_id = g.id
		 WHERE gm.user_id = $1
		 ORDER BY gm.joined_at`, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("guild list by user: %w", err)
	}
	defer rows.Close()

	var guilds []model.Guild
	for rows.Next() {
		var g model.Guild
		if err := rows.Scan(
			&g.ID, &g.Name, &g.Description, &g.IconUrl, &g.BannerUrl, &g.OwnerID,
			&g.IsStreamerServer, &g.MemberCount, pqJSONArray(&g.Features), &g.CreatedAt, &g.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("guild list by user scan: %w", err)
		}
		guilds = append(guilds, g)
	}
	return guilds, rows.Err()
}
