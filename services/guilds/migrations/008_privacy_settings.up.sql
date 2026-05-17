-- User privacy settings
CREATE TABLE user_privacy_settings (
    user_id UUID PRIMARY KEY,
    who_can_dm VARCHAR(20) NOT NULL DEFAULT 'everyone' CHECK (who_can_dm IN ('everyone', 'server_members', 'friends')),
    who_can_friend VARCHAR(20) NOT NULL DEFAULT 'everyone' CHECK (who_can_friend IN ('everyone', 'friends_of_friends', 'nobody')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-server DM privacy toggle
ALTER TABLE guild_members ADD COLUMN IF NOT EXISTS allow_dms BOOLEAN DEFAULT true;
