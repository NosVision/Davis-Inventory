-- 00178_profile_full_name_change_request.sql
-- Owner ask 2026-08-07: employees can request a correction to their own ชื่อ-นามสกุล.
--
-- full_name is the legal name that goes on ภ.ง.ด.1 / สปส. / ใบ 50 ทวิ and the bank-transfer
-- file, so it is NOT self-editable — it goes through the same request→HR-approve→apply path
-- that bank details and the emergency contact already use (hr_profile_change_requests).
-- The apply step in /api/hr/profile-change-requests/[id]/decide fails CLOSED on an unknown
-- field_key, so widening this CHECK alone is inert until that route learns the new key too.

alter table public.hr_profile_change_requests
  drop constraint if exists hr_profile_change_requests_field_key_check;

alter table public.hr_profile_change_requests
  add constraint hr_profile_change_requests_field_key_check
  check (field_key = any (array['bank_account', 'emergency_contact', 'full_name']));

comment on column public.hr_profile_change_requests.field_key is
  'Which part of the employee record this asks to change: bank_account | emergency_contact | full_name (the legal ชื่อ-นามสกุล used on tax filings and bank transfers).';
