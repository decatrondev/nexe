package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/decatrondev/nexe/services/guilds/internal/model"
	"github.com/lib/pq"
)

// DefaultEveryonePermissions is the default permission set for the @everyone role.
// Uses bit shifts matching model/permissions.go constants.
const DefaultEveryonePermissions int64 = model.PermSendMessages | // 1 << 16
	model.PermEmbedLinks | // 1 << 19
	model.PermAttachFiles | // 1 << 20
	model.PermReadMessageHistory | // 1 << 21
	model.PermAddReactions | // 1 << 24
	model.PermCreateInvite // 1 << 32

// guildColumns is the shared column list for all guild SELECT queries.
const guildColumns = `id, name, description, icon_url, banner_url, owner_id,
	is_streamer_server, streamer_twitch_id, bridge_channel_id, system_channel_id, accent_color,
	discoverable, category, tags, vanity_url,
	member_count, features, created_at, updated_at`

// scanGuild scans a row into a Guild model.
func scanGuild(row interface{ Scan(...interface{}) error }, g *model.Guild) error {
	return row.Scan(
		&g.ID, &g.Name, &g.Description, &g.IconUrl, &g.BannerUrl, &g.OwnerID,
		&g.IsStreamerServer, &g.StreamerTwitchID, &g.BridgeChannelID, &g.SystemChannelID, &g.AccentColor,
		&g.Discoverable, &g.Category, pq.Array(&g.Tags), &g.VanityUrl,
		&g.MemberCount, pqJSONArray(&g.Features), &g.CreatedAt, &g.UpdatedAt,
	)
}

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
		`SELECT `+guildColumns+` FROM guilds WHERE id = $1`, id,
	).Scan(
		&g.ID, &g.Name, &g.Description, &g.IconUrl, &g.BannerUrl, &g.OwnerID,
		&g.IsStreamerServer, &g.StreamerTwitchID, &g.BridgeChannelID, &g.SystemChannelID, &g.AccentColor,
		&g.Discoverable, &g.Category, pq.Array(&g.Tags), &g.VanityUrl,
		&g.MemberCount, pqJSONArray(&g.Features), &g.CreatedAt, &g.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("guild get by id: %w", err)
	}
	return &g, nil
}

func (r *GuildRepository) GetByVanityUrl(ctx context.Context, vanity string) (*model.Guild, error) {
	var g model.Guild
	err := r.db.QueryRowContext(ctx,
		`SELECT `+guildColumns+` FROM guilds WHERE vanity_url = $1`, vanity,
	).Scan(
		&g.ID, &g.Name, &g.Description, &g.IconUrl, &g.BannerUrl, &g.OwnerID,
		&g.IsStreamerServer, &g.StreamerTwitchID, &g.BridgeChannelID, &g.SystemChannelID, &g.AccentColor,
		&g.Discoverable, &g.Category, pq.Array(&g.Tags), &g.VanityUrl,
		&g.MemberCount, pqJSONArray(&g.Features), &g.CreatedAt, &g.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("guild get by vanity: %w", err)
	}
	return &g, nil
}

func (r *GuildRepository) Update(ctx context.Context, guild *model.Guild) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE guilds
		 SET name = $1, description = $2, icon_url = $3, banner_url = $4,
		     is_streamer_server = $5, system_channel_id = $6, accent_color = $7,
		     discoverable = $8, category = $9, tags = $10, vanity_url = $11,
		     updated_at = NOW()
		 WHERE id = $12`,
		guild.Name, guild.Description, guild.IconUrl, guild.BannerUrl,
		guild.IsStreamerServer, guild.SystemChannelID, guild.AccentColor,
		guild.Discoverable, guild.Category, pq.Array(guild.Tags), guild.VanityUrl,
		guild.ID,
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

func (r *GuildRepository) CountByOwner(ctx context.Context, ownerID string) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM guilds WHERE owner_id = $1`, ownerID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("guild count by owner: %w", err)
	}
	return count, nil
}

func (r *GuildRepository) CountMemberships(ctx context.Context, userID string) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM guild_members WHERE user_id = $1`, userID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("guild count memberships: %w", err)
	}
	return count, nil
}

func (r *GuildRepository) ListByUser(ctx context.Context, userID string) ([]model.Guild, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT g.id, g.name, g.description, g.icon_url, g.banner_url, g.owner_id,
		        g.is_streamer_server, g.streamer_twitch_id, g.bridge_channel_id, g.system_channel_id, g.accent_color,
		        g.discoverable, g.category, g.tags, g.vanity_url,
		        g.member_count, g.features, g.created_at, g.updated_at
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
		if err := scanGuild(rows, &g); err != nil {
			return nil, fmt.Errorf("guild list by user scan: %w", err)
		}
		guilds = append(guilds, g)
	}
	return guilds, rows.Err()
}

func (r *GuildRepository) ListByStreamerTwitchID(ctx context.Context, twitchID string) ([]model.Guild, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+guildColumns+` FROM guilds WHERE streamer_twitch_id = $1`, twitchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var guilds []model.Guild
	for rows.Next() {
		var g model.Guild
		if err := scanGuild(rows, &g); err != nil {
			return nil, err
		}
		guilds = append(guilds, g)
	}
	return guilds, nil
}

func (r *GuildRepository) ListWithTwitch(ctx context.Context) ([]model.Guild, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+guildColumns+` FROM guilds WHERE streamer_twitch_id IS NOT NULL AND streamer_twitch_id != ''`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var guilds []model.Guild
	for rows.Next() {
		var g model.Guild
		if err := scanGuild(rows, &g); err != nil {
			return nil, err
		}
		guilds = append(guilds, g)
	}
	return guilds, nil
}

// ---------------------------------------------------------------------------
// Server Discovery
// ---------------------------------------------------------------------------

// DiscoverParams holds the filter/search parameters for server discovery.
type DiscoverParams struct {
	Query    string
	Category string
	Tag      string
	Sort     string // "popular", "newest", "alphabetical"
	Limit    int
	Offset   int
}

func (r *GuildRepository) Discover(ctx context.Context, p DiscoverParams) ([]model.Guild, int, error) {
	if p.Limit <= 0 || p.Limit > 50 {
		p.Limit = 24
	}

	where := []string{"discoverable = true"}
	args := []interface{}{}
	argN := 1

	if p.Category != "" {
		where = append(where, fmt.Sprintf("category = $%d", argN))
		args = append(args, p.Category)
		argN++
	}
	if p.Tag != "" {
		where = append(where, fmt.Sprintf("$%d = ANY(tags)", argN))
		args = append(args, p.Tag)
		argN++
	}
	if p.Query != "" {
		where = append(where, fmt.Sprintf(
			"(to_tsvector('english', name || ' ' || COALESCE(description, '')) @@ plainto_tsquery('english', $%d) OR name ILIKE '%%' || $%d || '%%')",
			argN, argN))
		args = append(args, p.Query)
		argN++
	}

	whereClause := strings.Join(where, " AND ")

	// Count total
	var total int
	countQuery := "SELECT COUNT(*) FROM guilds WHERE " + whereClause
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("discover count: %w", err)
	}

	// Sort
	orderBy := "member_count DESC"
	switch p.Sort {
	case "newest":
		orderBy = "created_at DESC"
	case "alphabetical":
		orderBy = "name ASC"
	}

	query := fmt.Sprintf(
		`SELECT %s FROM guilds WHERE %s ORDER BY %s LIMIT $%d OFFSET $%d`,
		guildColumns, whereClause, orderBy, argN, argN+1,
	)
	args = append(args, p.Limit, p.Offset)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("discover query: %w", err)
	}
	defer rows.Close()

	var guilds []model.Guild
	for rows.Next() {
		var g model.Guild
		if err := scanGuild(rows, &g); err != nil {
			return nil, 0, fmt.Errorf("discover scan: %w", err)
		}
		guilds = append(guilds, g)
	}
	return guilds, total, rows.Err()
}

func (r *GuildRepository) ListCategories(ctx context.Context) ([]string, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT DISTINCT category FROM guilds WHERE discoverable = true AND category != '' ORDER BY category`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cats []string
	for rows.Next() {
		var c string
		rows.Scan(&c)
		cats = append(cats, c)
	}
	return cats, nil
}

func (r *GuildRepository) ListPopularTags(ctx context.Context, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT unnest(tags) AS tag, COUNT(*) AS cnt
		 FROM guilds WHERE discoverable = true AND array_length(tags, 1) > 0
		 GROUP BY tag ORDER BY cnt DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []string
	for rows.Next() {
		var tag string
		var cnt int
		rows.Scan(&tag, &cnt)
		tags = append(tags, tag)
	}
	return tags, nil
}

// ---------------------------------------------------------------------------
// Twitch helpers
// ---------------------------------------------------------------------------

func (r *GuildRepository) SetStreamerTwitchID(ctx context.Context, guildID, twitchID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE guilds SET streamer_twitch_id = $1, updated_at = NOW() WHERE id = $2`,
		twitchID, guildID)
	if err != nil {
		return fmt.Errorf("guild set streamer twitch id: %w", err)
	}
	return nil
}

func (r *GuildRepository) ClearStreamerTwitchID(ctx context.Context, guildID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE guilds SET streamer_twitch_id = NULL, updated_at = NOW() WHERE id = $1`,
		guildID)
	if err != nil {
		return fmt.Errorf("guild clear streamer twitch id: %w", err)
	}
	return nil
}

func (r *GuildRepository) SetBridgeChannel(ctx context.Context, guildID, channelID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE guilds SET bridge_channel_id = $1, updated_at = NOW() WHERE id = $2`,
		channelID, guildID)
	return err
}

func (r *GuildRepository) ClearBridgeChannel(ctx context.Context, guildID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE guilds SET bridge_channel_id = NULL, updated_at = NOW() WHERE id = $1`,
		guildID)
	return err
}
