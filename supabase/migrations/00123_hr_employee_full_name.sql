-- Formal (payroll) name — the printed slips and the accountant review carry the person's REAL
-- Thai full name, while profiles.display_name is the app nickname (chat/header). Identity-claim
-- approval fills this from the imported sheet name; HR can maintain it later. Fixes a silent
-- select of a non-existent hr_employees.display_name in the review/print paths.
alter table public.hr_employees add column full_name text;
