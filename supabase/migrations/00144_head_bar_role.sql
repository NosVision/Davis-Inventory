-- 00144_head_bar_role.sql
-- Add the "Head Bar" (หัวหน้าบาร์) position to the user_role enum — access rights are IDENTICAL
-- to Bar (owner ask 2026-07-09). It is a distinct title only (used for accountability, e.g. the
-- stock-violation warning target), not a distinct permission set. ADD VALUE must be its own
-- migration/transaction so the value is committed before anything references it.
alter type user_role add value if not exists 'head_bar';
