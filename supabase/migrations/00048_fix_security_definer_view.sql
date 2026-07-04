-- ============================================================================
-- 00048 · Fix SECURITY DEFINER view warning on v_monthly_violation_count
-- ----------------------------------------------------------------------------
-- Supabase Security Advisor (0010_security_definer_view) flagged this view
-- because it runs with the creator's privileges and bypasses the caller's
-- RLS on `public.penalties`. Switch to `security_invoker = true` so the
-- view inherits the querying user's permissions and RLS, which is what we
-- actually want — the underlying `penalties` table already has the right
-- policies.
-- ============================================================================

BEGIN;

ALTER VIEW public.v_monthly_violation_count
  SET (security_invoker = true);

COMMIT;
