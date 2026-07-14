-- 00164: dedupe guard on one-off payrun adjustments (money review 2026-07-14).
--
-- Two overlapping requests (double-click, two tabs pressing "copy from previous") could both
-- read "no duplicate yet" and both insert the same line — the employee would then be deducted
-- twice on the next recompute. An identical line = same (payrun, person, kind, label, amount);
-- a genuine second identical line is added by varying the label. The API maps the unique
-- violation to 409 (add) or a skip (copy).

create unique index if not exists hr_payrun_adjustments_dedupe_idx
  on public.hr_payrun_adjustments (payrun_id, profile_id, kind, label, amount_satang);
