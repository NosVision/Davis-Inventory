-- 00089_hr_swap_hardening.sql
-- P2.3a adversarial-review fixes for the day-off swap.

-- (CRITICAL) The approval RPC is SECURITY DEFINER with NO internal authorization — it
-- trusts that the app called requireStoreManager first. Postgres's default PUBLIC grant
-- otherwise leaves it callable by the `authenticated` role directly at /rest/v1/rpc,
-- letting a staffer self-approve their own swap and bypass the manager gate. Lock it to
-- the service client only, matching the module's established pattern (00062 / 00083).
revoke all on function public.hr_approve_dayoff_swap(uuid, uuid) from public, anon, authenticated;
grant execute on function public.hr_approve_dayoff_swap(uuid, uuid) to service_role;

-- (MEDIUM) At most one OPEN (pending) swap per identical requester-cell ↔ counterpart-cell,
-- so a double-click / replay can't create duplicate pending rows that would double-swap
-- (and then silently revert) the schedule when each is approved in turn.
create unique index if not exists hr_dayoff_swaps_one_open
  on public.hr_dayoff_swaps (requester_id, requester_date, counterpart_id, counterpart_date)
  where status = 'pending';
