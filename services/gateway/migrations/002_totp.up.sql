-- 2FA TOTP support
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id);
