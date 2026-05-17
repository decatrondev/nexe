-- Add is_request flag to dm_participants
-- When true, the DM shows in "Message Requests" instead of regular DMs
ALTER TABLE dm_participants ADD COLUMN is_request BOOLEAN DEFAULT false;
