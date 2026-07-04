-- Harden hr_payrun_is_finalized: remove the unauthenticated probing surface.
--
-- Advisor WARN (anon_security_definer_function_executable, Round 104): this SECURITY DEFINER
-- helper (created in 00106 for the hr_payslips_select RLS policy) is auto-exposed by PostgREST
-- at /rest/v1/rpc/hr_payrun_is_finalized, and Postgres' default PUBLIC grant let the `anon`
-- role call it — so anyone holding the (public) anon key could probe "is this payrun uuid
-- finalized?" without logging in. Leak is a single boolean behind an unguessable v4 uuid
-- (no PII, no amounts, read-only), hence WARN-level hardening rather than an active bug.
--
-- ⚠️ Deliberately NOT the full 00089 pattern (revoke anon + authenticated): unlike
-- hr_approve_dayoff_swap (service-role-only, called from server routes), this function is
-- invoked from INSIDE the hr_payslips_select RLS policy, and Postgres checks EXECUTE against
-- the querying role — revoking `authenticated` would break employees reading their own
-- finalized payslips (permission denied). `authenticated` keeps EXECUTE by design; it exposes
-- only the same boolean the RLS policy already implies.
--
-- Also revoke the blanket PUBLIC grant so future roles don't silently inherit EXECUTE.

revoke execute on function public.hr_payrun_is_finalized(uuid) from public;
revoke execute on function public.hr_payrun_is_finalized(uuid) from anon;

-- keep (re-assert) the grants the RLS policy and server paths rely on
grant execute on function public.hr_payrun_is_finalized(uuid) to authenticated;
grant execute on function public.hr_payrun_is_finalized(uuid) to service_role;
