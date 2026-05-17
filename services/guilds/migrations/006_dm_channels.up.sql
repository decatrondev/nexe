-- ============================================================
-- DM Channels & Participants
-- ============================================================
CREATE TABLE dm_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL DEFAULT 'dm' CHECK (type IN ('dm', 'group_dm')),
    name VARCHAR(100),
    icon_url VARCHAR(500),
    owner_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE dm_participants (
    channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    closed BOOLEAN DEFAULT false,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_dm_participants_user ON dm_participants(user_id);

-- ============================================================
-- DM Messages (separate from guild messages)
-- ============================================================
CREATE TABLE dm_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    author_id UUID NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    type VARCHAR(20) NOT NULL DEFAULT 'default',
    reply_to_id UUID,
    embeds JSONB DEFAULT '[]',
    attachments JSONB DEFAULT '[]',
    mention_everyone BOOLEAN DEFAULT false,
    edited_at TIMESTAMPTZ,
    deleted BOOLEAN DEFAULT false,
    pinned BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dm_messages_channel ON dm_messages(channel_id, created_at DESC);
CREATE INDEX idx_dm_messages_author ON dm_messages(author_id);
