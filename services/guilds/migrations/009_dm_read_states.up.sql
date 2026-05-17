CREATE TABLE IF NOT EXISTS dm_read_states (
    user_id UUID NOT NULL,
    channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    last_read_message_id UUID,
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);

-- Add pinned column to dm_participants
ALTER TABLE dm_participants ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT false;
