-- 00158 — record when a payrun's bank-transfer file was exported, so reopening a paid payrun
-- cannot silently rewind payroll after money has already moved (§Phase 0B).
--
-- The bank file is the artifact HR hands to the bank to pay net salary. Once exported and paid,
-- reopening the payrun back to draft and regenerating would change amounts that were already
-- transferred, with no signal that money moved. Stamping the export lets /reopen refuse (or demand
-- an explicit, audited override) once a file exists.

alter table public.hr_payruns
  add column if not exists bank_exported_at timestamptz,
  add column if not exists bank_exported_by uuid references public.profiles(id);

comment on column public.hr_payruns.bank_exported_at is
  'When the direct-credit bank file was last exported for this payrun. Non-null => money may have been transferred; reopening requires an explicit override.';
comment on column public.hr_payruns.bank_exported_by is
  'profiles.id of the HR user who last exported the bank file.';
