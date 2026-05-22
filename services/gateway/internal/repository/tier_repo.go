package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/decatrondev/nexe/services/gateway/internal/model"
	"github.com/redis/go-redis/v9"
)

const tierCacheKey = "nexe:tier_limits:%s"
const tierCacheTTL = 5 * time.Minute

type TierRepository struct {
	db  *sql.DB
	rdb *redis.Client
}

func NewTierRepository(db *sql.DB, rdb *redis.Client) *TierRepository {
	return &TierRepository{db: db, rdb: rdb}
}

func (r *TierRepository) GetLimits(ctx context.Context, tier string) (*model.TierLimits, error) {
	if tier == "" {
		tier = "free"
	}

	// Try Redis cache
	key := fmt.Sprintf(tierCacheKey, tier)
	cached, err := r.rdb.Get(ctx, key).Result()
	if err == nil {
		var limits model.TierLimits
		if json.Unmarshal([]byte(cached), &limits) == nil {
			return &limits, nil
		}
	}

	// Query DB
	var l model.TierLimits
	err = r.db.QueryRowContext(ctx, `
		SELECT tier, max_owned_guilds, max_emojis_per_guild, max_stickers_per_guild,
		       max_upload_bytes, voice_bitrate, screen_share_quality,
		       animated_avatar, animated_banner, video_banner,
		       chat_bridge_channels, analytics_days, server_boosts, priority_support,
		       max_message_length, max_bio_length, max_social_links,
		       max_badges_visible, max_clips_showcase,
		       profile_effects, profile_music, custom_css, drag_drop_layout,
		       custom_background, featured_servers, vanity_slug, visitor_counter,
		       upload_storage_bytes
		FROM tier_limits WHERE tier = $1`, tier,
	).Scan(
		&l.Tier, &l.MaxOwnedGuilds, &l.MaxEmojisPerGuild, &l.MaxStickersPerGuild,
		&l.MaxUploadBytes, &l.VoiceBitrate, &l.ScreenShareQuality,
		&l.AnimatedAvatar, &l.AnimatedBanner, &l.VideoBanner,
		&l.ChatBridgeChannels, &l.AnalyticsDays, &l.ServerBoosts, &l.PrioritySupport,
		&l.MaxMessageLength, &l.MaxBioLength, &l.MaxSocialLinks,
		&l.MaxBadgesVisible, &l.MaxClipsShowcase,
		&l.ProfileEffects, &l.ProfileMusic, &l.CustomCSS, &l.DragDropLayout,
		&l.CustomBackground, &l.FeaturedServers, &l.VanitySlug, &l.VisitorCounter,
		&l.UploadStorageBytes,
	)
	if err != nil {
		return nil, fmt.Errorf("get tier limits: %w", err)
	}

	// Cache
	if data, err := json.Marshal(l); err == nil {
		r.rdb.Set(ctx, key, data, tierCacheTTL)
	}

	return &l, nil
}

func (r *TierRepository) SetUserTier(ctx context.Context, userID, tier string, expiresAt *time.Time) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO user_tiers (user_id, tier, started_at, expires_at, updated_at)
		VALUES ($1, $2, NOW(), $3, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			tier = $2, started_at = NOW(), expires_at = $3, updated_at = NOW()`,
		userID, tier, expiresAt,
	)
	if err != nil {
		return fmt.Errorf("set user tier: %w", err)
	}

	// Invalidate cache
	r.rdb.Del(ctx, fmt.Sprintf("nexe:user_tier:%s", userID))

	return nil
}

func (r *TierRepository) GetUserTier(ctx context.Context, userID string) (string, error) {
	cacheKey := fmt.Sprintf("nexe:user_tier:%s", userID)

	// Try cache
	cached, err := r.rdb.Get(ctx, cacheKey).Result()
	if err == nil {
		return cached, nil
	}

	var tier string
	err = r.db.QueryRowContext(ctx,
		`SELECT tier FROM user_tiers WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
		userID,
	).Scan(&tier)
	if err != nil {
		tier = "free"
	}

	r.rdb.Set(ctx, cacheKey, tier, tierCacheTTL)
	return tier, nil
}

func (r *TierRepository) InvalidateCache(ctx context.Context, tier string) {
	r.rdb.Del(ctx, fmt.Sprintf(tierCacheKey, tier))
}
