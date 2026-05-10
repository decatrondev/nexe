-- Add bridge channel ID to guilds for Twitch chat bridge
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS bridge_channel_id UUID;
