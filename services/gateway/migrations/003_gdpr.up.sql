-- GDPR: Scheduled account deletions
CREATE TABLE IF NOT EXISTS scheduled_deletions (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    reason VARCHAR(255) NOT NULL DEFAULT 'user_request',
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delete_after TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
    cancelled BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_scheduled_deletions_pending
    ON scheduled_deletions (delete_after) WHERE cancelled = false;
