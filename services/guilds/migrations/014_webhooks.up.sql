-- Incoming Webhooks
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL,
    creator_id UUID NOT NULL,
    name VARCHAR(80) NOT NULL,
    avatar_url TEXT,
    token VARCHAR(64) NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_guild ON webhooks (guild_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_channel ON webhooks (channel_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_token ON webhooks (token);
