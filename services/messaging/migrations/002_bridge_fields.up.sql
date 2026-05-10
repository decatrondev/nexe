-- Add bridge fields to messages for cross-platform chat
ALTER TABLE messages ADD COLUMN IF NOT EXISTS bridge_source VARCHAR(20);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS bridge_author VARCHAR(100);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS bridge_author_id VARCHAR(100);

-- Allow null author_id for bridge messages (external users don't have Nexe accounts)
ALTER TABLE messages ALTER COLUMN author_id DROP NOT NULL;

CREATE INDEX idx_messages_bridge ON messages(bridge_source) WHERE bridge_source IS NOT NULL;
