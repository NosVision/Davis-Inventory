-- 00049_add_technician_role.sql
-- Add the "technician" (ช่าง) role to the user_role enum.
-- NOTE: ALTER TYPE ... ADD VALUE must live in its own migration, separate from
-- any statement that uses the new value, so the value is committed first.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'technician';
