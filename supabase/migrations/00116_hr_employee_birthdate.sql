-- P1.5 backlog: employee birth date — powers the dashboard birthday reminder (same month-day
-- window as work anniversaries). Nullable; HR fills it from the personnel file over time.
alter table public.hr_employees add column birth_date date;
