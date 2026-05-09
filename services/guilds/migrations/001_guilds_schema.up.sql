-- ============================================================
-- Guilds
-- ============================================================
CREATE TABLE guilds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon_url VARCHAR(500),
    banner_url VARCHAR(500),
    owner_id UUID NOT NULL,
    is_streamer_server BOOLEAN DEFAULT false,
    streamer_twitch_id VARCHAR(50),
    region VARCHAR(20) DEFAULT 'auto',
    default_notifications VARCHAR(20) DEFAULT 'mentions',
    verification_level INT DEFAULT 0,
    member_count INT DEFAULT 0,
    max_members INT DEFAULT 500000,
    features JSONB DEFAULT '[]',
    vanity_url VARCHAR(50) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_guilds_owner ON guilds(owner_id);

-- ============================================================
-- Categories
-- ============================================================
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_categories_guild ON categories(guild_id);

-- ============================================================
-- Channels
-- ============================================================
CREATE TABLE channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    topic TEXT,
    type VARCHAR(20) NOT NULL DEFAULT 'text',
    position INT NOT NULL DEFAULT 0,
    slowmode_seconds INT DEFAULT 0,
    nsfw BOOLEAN DEFAULT false,
    is_sub_only BOOLEAN DEFAULT false,
    is_live_channel BOOLEAN DEFAULT false,
    last_message_id UUID,
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_channels_guild ON channels(guild_id);

-- ============================================================
-- Roles
-- ============================================================
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7),
    icon_url VARCHAR(500),
    position INT NOT NULL DEFAULT 0,
    permissions BIGINT NOT NULL DEFAULT 0,
    mentionable BOOLEAN DEFAULT false,
    hoisted BOOLEAN DEFAULT false,
    is_default BOOLEAN DEFAULT false,
    is_auto BOOLEAN DEFAULT false,
    auto_source VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_roles_guild ON roles(guild_id);

-- ============================================================
-- Guild Members
-- ============================================================
CREATE TABLE guild_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    nickname VARCHAR(64),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    muted BOOLEAN DEFAULT false,
    muted_until TIMESTAMPTZ,
    deaf BOOLEAN DEFAULT false,
    UNIQUE (guild_id, user_id)
);

CREATE INDEX idx_members_guild ON guild_members(guild_id);
CREATE INDEX idx_members_user ON guild_members(user_id);

-- ============================================================
-- Member Roles
-- ============================================================
CREATE TABLE member_roles (
    member_id UUID NOT NULL REFERENCES guild_members(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by UUID,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (member_id, role_id)
);

-- ============================================================
-- Channel Permission Overrides
-- ============================================================
CREATE TABLE channel_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_type VARCHAR(10) NOT NULL,
    target_id UUID NOT NULL,
    allow BIGINT NOT NULL DEFAULT 0,
    deny BIGINT NOT NULL DEFAULT 0,
    UNIQUE (channel_id, target_type, target_id)
);

-- ============================================================
-- Invites
-- ============================================================
CREATE TABLE invites (
    code VARCHAR(12) PRIMARY KEY,
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    inviter_id UUID NOT NULL,
    max_uses INT,
    uses INT DEFAULT 0,
    max_age_seconds INT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Bans
-- ============================================================
CREATE TABLE bans (
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    banned_by UUID NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (guild_id, user_id)
);

-- ============================================================
-- Moderation Logs
-- ============================================================
CREATE TABLE moderation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    moderator_id UUID NOT NULL,
    target_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL,
    reason TEXT,
    duration_seconds INT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_modlogs_guild ON moderation_logs(guild_id, created_at DESC);

-- ============================================================
-- Automod Rules
-- ============================================================
CREATE TABLE automod_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    enabled BOOLEAN DEFAULT true,
    config JSONB NOT NULL,
    action VARCHAR(20) NOT NULL,
    action_duration_seconds INT,
    exempt_roles UUID[] DEFAULT '{}',
    exempt_channels UUID[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_automod_guild ON automod_rules(guild_id);

-- ============================================================
-- Emojis
-- ============================================================
CREATE TABLE emojis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name VARCHAR(32) NOT NULL,
    url VARCHAR(500) NOT NULL,
    animated BOOLEAN DEFAULT false,
    uploaded_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_emojis_guild ON emojis(guild_id);
