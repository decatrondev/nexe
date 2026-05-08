-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Users
-- ============================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(32) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    email_verified BOOLEAN DEFAULT false,
    password_hash VARCHAR(255),
    totp_secret VARCHAR(255),
    totp_enabled BOOLEAN DEFAULT false,
    recovery_codes JSONB,
    twitch_id VARCHAR(50) UNIQUE,
    twitch_login VARCHAR(50),
    twitch_display_name VARCHAR(50),
    twitch_access_token TEXT,
    twitch_refresh_token TEXT,
    twitch_token_expires_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'offline',
    custom_status_text VARCHAR(128),
    custom_status_emoji VARCHAR(64),
    locale VARCHAR(5) DEFAULT 'en',
    flags BIGINT DEFAULT 0,
    disabled BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_twitch ON users(twitch_id) WHERE twitch_id IS NOT NULL;
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- Sessions (refresh tokens)
-- ============================================================
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    device_name VARCHAR(100),
    ip_address INET,
    user_agent TEXT,
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ============================================================
-- User tiers
-- ============================================================
CREATE TABLE user_tiers (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tier VARCHAR(20) NOT NULL DEFAULT 'free',
    started_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    payment_provider VARCHAR(20),
    payment_id VARCHAR(255),
    auto_renew BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Tier limits (seed data)
-- ============================================================
CREATE TABLE tier_limits (
    tier VARCHAR(20) PRIMARY KEY,
    max_owned_guilds INT NOT NULL,
    max_emojis_per_guild INT NOT NULL,
    max_upload_bytes BIGINT NOT NULL,
    voice_bitrate INT NOT NULL,
    animated_avatar BOOLEAN NOT NULL,
    animated_banner BOOLEAN NOT NULL,
    chat_bridge_channels INT NOT NULL,
    analytics_days INT NOT NULL,
    max_active_threads INT NOT NULL,
    search_history_days INT NOT NULL,
    server_boosts INT NOT NULL,
    watch_party BOOLEAN NOT NULL DEFAULT false,
    priority_support BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO tier_limits VALUES
('free',     5,  50,  52428800,   128000, false, false, 0,  7,  10, 30,  0, false, false),
('pro',      20, 200, 104857600,  256000, true,  false, 1,  90, 50, 365, 2, false, false),
('streamer', -1, 500, 524288000,  320000, true,  true,  -1, -1, -1, -1,  5, true,  true);

-- ============================================================
-- Email verification
-- ============================================================
CREATE TABLE email_verification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    code VARCHAR(6) NOT NULL,
    attempts INT DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_verify_email ON email_verification(email, expires_at);

-- ============================================================
-- Profiles
-- ============================================================
CREATE TABLE profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(64),
    bio TEXT,
    avatar_url VARCHAR(500),
    banner_url VARCHAR(500),
    accent_color VARCHAR(7),
    background_url VARCHAR(500),
    layout JSONB DEFAULT '{}',
    social_links JSONB DEFAULT '[]',
    featured_clips JSONB DEFAULT '[]',
    stream_schedule JSONB DEFAULT '{}',
    visibility JSONB DEFAULT '{}',
    level INT DEFAULT 1,
    total_xp BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Badges
-- ============================================================
CREATE TABLE badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    description TEXT,
    icon_url VARCHAR(500) NOT NULL,
    type VARCHAR(20) NOT NULL,
    guild_id UUID,
    requirement JSONB,
    tier_required VARCHAR(20) DEFAULT 'free',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_badges (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    badge_id UUID REFERENCES badges(id) ON DELETE CASCADE,
    displayed BOOLEAN DEFAULT false,
    display_order INT DEFAULT 0,
    earned_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, badge_id)
);

-- ============================================================
-- Bot applications
-- ============================================================
CREATE TABLE bot_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon_url VARCHAR(500),
    client_id VARCHAR(64) NOT NULL UNIQUE,
    client_secret_hash VARCHAR(255) NOT NULL,
    redirect_uris TEXT[] NOT NULL,
    scopes TEXT[] NOT NULL,
    bot_user_id UUID REFERENCES users(id),
    public BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
