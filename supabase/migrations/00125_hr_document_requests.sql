-- ⑥ Document request center (owner/เมย์ 2026-07-06): employees ask for personal tax/salary
-- documents — 50 ทวิ (annual withholding cert), salary certificate, a back-copy of an old
-- slip, or other — and HR fulfils either by SYSTEM-GENERATING (we hold the payslip data) or by
-- ATTACHING a file the accounting office produced. Ready docs are readable by the employee only.
create table public.hr_document_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  doc_type text not null check (doc_type in ('cert_50twi', 'salary_cert', 'slip_copy', 'other')),
  year int,                                   -- for annual docs (50 ทวิ / salary cert)
  payslip_id uuid references public.hr_payslips(id) on delete set null, -- for slip_copy
  note text,
  status text not null default 'requested' check (status in ('requested', 'ready', 'rejected')),
  fulfillment text check (fulfillment in ('generated', 'file')),
  file_path text,                             -- hr-documents private bucket path (file mode)
  generated_data jsonb,                       -- computed figures (generate mode)
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hr_document_requests_status on public.hr_document_requests (status);
create index hr_document_requests_profile on public.hr_document_requests (profile_id);

alter table public.hr_document_requests enable row level security;

-- HR-only via RLS; employees reach their own requests through the service-role ESS routes.
create policy hr_document_requests_hr_all on public.hr_document_requests
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());
