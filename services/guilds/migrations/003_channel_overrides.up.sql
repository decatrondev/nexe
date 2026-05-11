-- Channel permission overrides
CREATE TABLE IF NOT EXISTS channel_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_id UUID NOT NULL,           -- role_id or user_id
    target_type VARCHAR(10) NOT NULL,  -- 'role' or 'user'
    allow BIGINT NOT NULL DEFAULT 0,   -- bitmask of allowed permissions
    deny BIGINT NOT NULL DEFAULT 0,    -- bitmask of denied permissions
    UNIQUE (channel_id, target_id, target_type)
);

CREATE INDEX idx_channel_overrides_channel ON channel_overrides(channel_id);
