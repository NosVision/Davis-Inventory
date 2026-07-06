-- ⑤ "เงินเดือนออกแล้ว" announcement stamps: when the payslip-ready push went out and who fired
-- it (manual mode) — prevents double-blasting a whole company's phones by accident.
alter table public.hr_payruns add column announced_at timestamptz;
alter table public.hr_payruns add column announced_by uuid references public.profiles(id) on delete set null;
