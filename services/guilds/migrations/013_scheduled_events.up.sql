-- Scheduled Events for servers
CREATE TABLE IF NOT EXISTS guild_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location VARCHAR(255) NOT NULL DEFAULT '',
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    image_url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled', -- scheduled, active, completed, canceled
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_event_rsvps (
    event_id UUID NOT NULL REFERENCES guild_events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'interested', -- interested, going
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_guild_events_guild ON guild_events (guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_events_start ON guild_events (start_time) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_guild_event_rsvps_event ON guild_event_rsvps (event_id);
