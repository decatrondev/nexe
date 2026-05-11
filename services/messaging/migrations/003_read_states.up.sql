-- Track last read message per user per channel
CREATE TABLE IF NOT EXISTS read_states (
    user_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    last_read_message_id UUID,
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX idx_read_states_user ON read_states(user_id);
