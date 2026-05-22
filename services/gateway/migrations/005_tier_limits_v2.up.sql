-- Upgrade tier_limits with all new profile/feature columns
-- and rename streamer → ultra

-- Add new columns
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS max_stickers_per_guild INT NOT NULL DEFAULT 20;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS screen_share_quality VARCHAR(20) NOT NULL DEFAULT '720p30';
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS video_banner BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS max_message_length INT NOT NULL DEFAULT 2000;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS max_bio_length INT NOT NULL DEFAULT 300;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS max_social_links INT NOT NULL DEFAULT 5;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS max_badges_visible INT NOT NULL DEFAULT 5;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS max_clips_showcase INT NOT NULL DEFAULT 4;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS profile_effects BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS profile_music BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS custom_css BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS drag_drop_layout BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS custom_background BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS featured_servers INT NOT NULL DEFAULT 0;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS vanity_slug BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS visitor_counter BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tier_limits ADD COLUMN IF NOT EXISTS upload_storage_bytes BIGINT NOT NULL DEFAULT 52428800;

-- Delete old rows and re-insert with correct values
DELETE FROM tier_limits;

INSERT INTO tier_limits (
  tier, max_owned_guilds, max_emojis_per_guild, max_stickers_per_guild,
  max_upload_bytes, voice_bitrate, screen_share_quality,
  animated_avatar, animated_banner, video_banner,
  chat_bridge_channels, analytics_days, max_active_threads, search_history_days,
  server_boosts, watch_party, priority_support,
  max_message_length, max_bio_length, max_social_links,
  max_badges_visible, max_clips_showcase,
  profile_effects, profile_music, custom_css, drag_drop_layout,
  custom_background, featured_servers, vanity_slug, visitor_counter,
  upload_storage_bytes
) VALUES
-- FREE: generous, better than Discord free
('free', 10, 50, 20,
  26214400, 128000, '720p30',
  false, false, false,
  1, 7, -1, -1,
  0, false, false,
  2000, 300, 5,
  5, 4,
  false, false, false, false,
  false, 0, false, false,
  52428800),

-- PRO $5/mo: better than Discord Nitro $10
('pro', 50, 100, 50,
  104857600, 256000, '1080p30',
  true, true, false,
  3, 90, -1, -1,
  2, false, false,
  2000, 800, 12,
  10, 8,
  true, true, false, false,
  true, 2, false, true,
  524288000),

-- ULTRA $10/mo: no equivalent in Discord
('ultra', -1, 200, 100,
  524288000, 320000, '1080p60',
  true, true, true,
  -1, -1, -1, -1,
  5, true, true,
  4000, 1500, -1,
  -1, 16,
  true, true, true, true,
  true, 5, true, true,
  2147483648);

-- Update any users that had 'streamer' tier to 'ultra'
UPDATE user_tiers SET tier = 'ultra' WHERE tier = 'streamer';
