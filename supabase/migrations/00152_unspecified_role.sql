-- New 'unspecified' role (owner ask 2026-07-10): the default for self-registered employees
-- until HR assigns a real role. It carries no permissions and sees only the baseline menus
-- (chat / me / task rooms), so a pending hire can log in and use their personal + task surfaces
-- without touching any operational module. App-side: src/types/roles.ts + registry ALL_STAFF.
alter type public.user_role add value if not exists 'unspecified';
