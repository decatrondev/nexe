-- Server Discovery: add discoverable fields to guilds
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS discoverable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS vanity_url VARCHAR(32) UNIQUE;

-- Index for discovery queries
CREATE INDEX IF NOT EXISTS idx_guilds_discoverable ON guilds (discoverable) WHERE discoverable = true;
CREATE INDEX IF NOT EXISTS idx_guilds_category ON guilds (category) WHERE discoverable = true AND category != '';
CREATE INDEX IF NOT EXISTS idx_guilds_vanity ON guilds (vanity_url) WHERE vanity_url IS NOT NULL;

-- GIN index for tag search
CREATE INDEX IF NOT EXISTS idx_guilds_tags ON guilds USING GIN (tags) WHERE discoverable = true;

-- Full-text search on name + description for discovery
CREATE INDEX IF NOT EXISTS idx_guilds_search ON guilds USING GIN (
  to_tsvector('english', name || ' ' || COALESCE(description, ''))
) WHERE discoverable = true;
