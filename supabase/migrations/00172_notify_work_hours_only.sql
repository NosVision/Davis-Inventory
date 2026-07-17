-- 00172: per-user "notify only during my work hours" quiet gate for web push (owner ask 2026-07-17).
-- When ON, web push is suppressed unless the person is within their scheduled shift (± a small buffer)
-- or currently clocked in. In-app notifications are unaffected — they still record and appear when the
-- app is opened. Default false so existing users see no behaviour change until they opt in.
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS notify_work_hours_only boolean NOT NULL DEFAULT false;
