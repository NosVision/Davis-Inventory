-- Task-room LINE group notifications via a dedicated CENTRAL task bot (separate LINE channel from
-- the per-store customer OAs). A room can push its task events to one LINE group; the bot's
-- token/secret live in system_settings ('tasks.line_bot_token' / 'tasks.line_bot_secret').
ALTER TABLE task_rooms
  ADD COLUMN IF NOT EXISTS line_notify_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS line_group_id text;

COMMENT ON COLUMN task_rooms.line_notify_enabled IS 'Push this room''s task events to a LINE group via the central task bot';
COMMENT ON COLUMN task_rooms.line_group_id IS 'Target LINE group id — invite the central task bot to the group and type "groupid" to get it';
