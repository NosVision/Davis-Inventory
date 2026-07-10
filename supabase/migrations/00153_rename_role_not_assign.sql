-- Rename the pending-hire role from 'unspecified' to 'not_assign' (owner's preferred name,
-- 2026-07-10). No profile carries the value yet, so the rename is safe. App-side the role is
-- referenced as 'not_assign' everywhere (src/types/roles.ts, registry ALL_STAFF, etc.).
alter type public.user_role rename value 'unspecified' to 'not_assign';
