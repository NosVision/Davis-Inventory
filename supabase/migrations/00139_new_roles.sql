-- 00139_new_roles.sql
-- New staff roles for the reworked access model (owner ask 2026-07-08): a cashier plus floor
-- staff (house-keeping, back-of-house). Maintenance reuses the existing `technician` value
-- (relabelled in the app). ADD VALUE is idempotent and must not be USED in the same transaction.
alter type user_role add value if not exists 'cashier';
alter type user_role add value if not exists 'housekeeping_staff';
alter type user_role add value if not exists 'boh_staff';
