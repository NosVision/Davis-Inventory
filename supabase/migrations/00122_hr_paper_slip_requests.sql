-- Paper-slip requests (owner/เมย์ 2026-07-06): digital slips are the default; paper is
-- printed ONLY for people who ask — either a per-slip request or a standing "ขอกระดาษทุกเดือน"
-- preference — and HR gets a per-payrun print queue with printed-tracking (the slips are
-- confidential documents; who printed what, when, must be answerable).
alter table public.hr_employees add column paper_slip_standing boolean not null default false;

create table public.hr_payslip_print_requests (
  id uuid primary key default gen_random_uuid(),
  payslip_id uuid not null references public.hr_payslips(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null, -- null = standing preference auto-queued
  requested_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested', 'printed', 'cancelled')),
  printed_by uuid references public.profiles(id) on delete set null,
  printed_at timestamptz,
  unique (payslip_id)
);

alter table public.hr_payslip_print_requests enable row level security;

create policy hr_payslip_print_requests_hr_all on public.hr_payslip_print_requests
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());
