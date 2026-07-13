-- 00156_hr_eval_payout_unique_result.sql
-- At most ONE payout per evaluation result. The payouts recompute previously deleted only
-- status='draft' rows before re-inserting, so a result that already had an APPROVED payout got a
-- second (draft) one — approve-all then produced two approved payouts and doubled the eval bonus /
-- SC deduction. The route now skips results that already have a payout; this unique constraint is
-- the database backstop. (hr_eval_payouts is empty in production, so this applies cleanly.)
alter table public.hr_eval_payouts
  add constraint hr_eval_payouts_result_id_key unique (result_id);
