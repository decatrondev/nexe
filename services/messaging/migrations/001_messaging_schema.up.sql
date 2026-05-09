-- ============================================================
-- Messages
-- ============================================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL,
    author_id UUID NOT NULL,
    content TEXT,
    type VARCHAR(20) DEFAULT 'default',
    reply_to_id UUID,
    thread_id UUID,
    edited_at TIMESTAMPTZ,
    deleted BOOLEAN DEFAULT false,
    deleted_at TIMESTAMPTZ,
    pinned BOOLEAN DEFAULT false,
    pinned_at TIMESTAMPTZ,
    pinned_by UUID,
    embeds JSONB DEFAULT '[]',
    mention_everyone BOOLEAN DEFAULT false,
    mention_roles UUID[] DEFAULT '{}',
    search_vector TSVECTOR,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_author ON messages(author_id);
CREATE INDEX idx_messages_search ON messages USING GIN(search_vector);
CREATE INDEX idx_messages_thread ON messages(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX idx_messages_reply ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

-- Auto-update search vector
CREATE OR REPLACE FUNCTION messages_search_trigger() RETURNS trigger AS $$
BEGIN
    NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_messages_search
    BEFORE INSERT OR UPDATE OF content ON messages
    FOR EACH ROW EXECUTE FUNCTION messages_search_trigger();

-- ============================================================
-- Message edits history
-- ============================================================
CREATE TABLE message_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    old_content TEXT NOT NULL,
    edited_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_edits_message ON message_edits(message_id);

-- ============================================================
-- Reactions
-- ============================================================
CREATE TABLE reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    emoji VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id, emoji)
);

-- ============================================================
-- Attachments
-- ============================================================
CREATE TABLE attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    url VARCHAR(500) NOT NULL,
    content_type VARCHAR(100),
    size_bytes BIGINT NOT NULL,
    width INT,
    height INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attachments_message ON attachments(message_id);
