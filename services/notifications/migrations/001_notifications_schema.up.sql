-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    type VARCHAR(30) NOT NULL,
    guild_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    message_id UUID,
    author_id UUID,
    content TEXT NOT NULL DEFAULT '',
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id) WHERE read = false;

-- Notification preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id UUID NOT NULL,
    guild_id UUID NOT NULL,
    channel_id UUID,
    level VARCHAR(20) NOT NULL DEFAULT 'mentions',
    UNIQUE (user_id, guild_id, channel_id)
);

-- Create unique index for guild-level preferences (where channel_id IS NULL)
CREATE UNIQUE INDEX idx_notif_pref_guild ON notification_preferences (user_id, guild_id) WHERE channel_id IS NULL;

-- Auto-cleanup: delete notifications older than 30 days (run via cron or manual)
-- DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '30 days';
