-- DM Reactions
CREATE TABLE IF NOT EXISTS dm_reactions (
    message_id UUID NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX idx_dm_reactions_message ON dm_reactions(message_id);
