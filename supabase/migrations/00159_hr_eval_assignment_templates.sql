-- 00159 — reusable per-store evaluation assignment templates (§Phase 4).
-- HR sets up "who evaluates whom" for a store once, saves it as a named template, and pulls it
-- back next month instead of re-picking everyone. The evaluator→employee pairs are a jsonb
-- snapshot (not FK rows) so a template survives staff churn — invalid people are simply skipped
-- when the template is applied.

create table if not exists public.hr_eval_assignment_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  -- [{ "evaluator_id": uuid, "employee_id": uuid }, ...]
  pairs jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_eval_assignment_templates_store_idx
  on public.hr_eval_assignment_templates(store_id);

alter table public.hr_eval_assignment_templates enable row level security;

-- HR-managed config (same gate as the rest of the evaluation family).
drop policy if exists hr_eval_assignment_templates_all on public.hr_eval_assignment_templates;
create policy hr_eval_assignment_templates_all
  on public.hr_eval_assignment_templates
  for all to authenticated
  using (can_manage_hr())
  with check (can_manage_hr());
