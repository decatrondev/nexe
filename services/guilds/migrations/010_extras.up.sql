-- Friend categories (custom groups)
CREATE TABLE friend_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7),
    position INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_friend_categories_user ON friend_categories(user_id);

-- Junction: which friends belong to which category
CREATE TABLE friend_category_members (
    category_id UUID NOT NULL REFERENCES friend_categories(id) ON DELETE CASCADE,
    friend_user_id UUID NOT NULL,
    PRIMARY KEY (category_id, friend_user_id)
);

-- Scheduled DM messages
CREATE TABLE dm_scheduled_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    author_id UUID NOT NULL,
    content TEXT NOT NULL,
    send_at TIMESTAMPTZ NOT NULL,
    sent BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dm_scheduled_pending ON dm_scheduled_messages(send_at) WHERE sent = false;

-- DM message reminders
CREATE TABLE dm_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    message_id UUID NOT NULL,
    remind_at TIMESTAMPTZ NOT NULL,
    fired BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dm_reminders_pending ON dm_reminders(remind_at) WHERE fired = false;
