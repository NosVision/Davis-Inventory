-- 00177_commission_wht_certs.sql
-- Two owner asks on the commission module (2026-08-06):
--
--  1. "เมื่อทำเรื่องเบิกจ่ายไปแล้ว ยังสามารถดูบิลเก่าได้" — a settled round must keep showing the
--     bills behind it. Today the link is only commission_entries.payment_id, and CANCELLING a
--     payment clears it (entries have to return to the unpaid pool), which erases the record of
--     what that transfer covered. Snapshot the ids on the payment itself so the "what was this
--     transfer for?" question survives a cancellation.
--
--  2. "สามารถใส่ได้ว่าใครขอใบ 50 ทวิบ้าง" — a monthly report where the accountant marks which AEs
--     asked for a withholding-tax certificate (ใบ 50 ทวิ) for that month, and ticks it off once
--     issued. One row per (store, AE, month); the row existing IS the request.

alter table public.commission_payments
  add column if not exists entry_ids uuid[];

comment on column public.commission_payments.entry_ids is
  'Bills this payout covered, snapshotted at creation. Survives a cancellation (which nulls commission_entries.payment_id) so the round can still be inspected.';

-- Backfill from the live links — accurate for every payment that has not been cancelled.
update public.commission_payments p
set entry_ids = e.ids
from (
  select payment_id, array_agg(id) as ids
  from public.commission_entries
  where payment_id is not null
  group by payment_id
) e
where e.payment_id = p.id
  and p.entry_ids is null;

create table if not exists public.commission_wht_certs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  ae_id uuid not null references public.ae_profiles(id) on delete cascade,
  month text not null,                       -- 'YYYY-MM', same convention as commission_payments
  status text not null default 'requested' check (status in ('requested', 'issued')),
  note text,
  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  issued_by uuid references public.profiles(id),
  issued_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (store_id, ae_id, month)
);

comment on table public.commission_wht_certs is
  'ใบ 50 ทวิ (withholding-tax certificate) requests per AE per month. A row means "this AE asked"; status flips to issued when the accountant hands it over.';

create index if not exists idx_commission_wht_certs_month on public.commission_wht_certs (store_id, month);

alter table public.commission_wht_certs enable row level security;

-- Same audience as the commission money itself (see 00140): store members, admins, and the
-- accountant/cashier roles who work across stores.
create policy "commission_wht_certs_select" on public.commission_wht_certs
  for select to authenticated
  using (
    store_id in (select public.get_user_store_ids())
    or public.is_admin()
    or public.get_user_role() = any (array['accountant', 'cashier']::public.user_role[])
  );
create policy "commission_wht_certs_insert" on public.commission_wht_certs
  for insert to authenticated
  with check (
    store_id in (select public.get_user_store_ids())
    or public.is_admin()
    or public.get_user_role() = any (array['accountant', 'cashier']::public.user_role[])
  );
create policy "commission_wht_certs_update" on public.commission_wht_certs
  for update to authenticated
  using (
    store_id in (select public.get_user_store_ids())
    or public.is_admin()
    or public.get_user_role() = any (array['accountant', 'cashier']::public.user_role[])
  );
create policy "commission_wht_certs_delete" on public.commission_wht_certs
  for delete to authenticated
  using (
    store_id in (select public.get_user_store_ids())
    or public.is_admin()
    or public.get_user_role() = any (array['accountant', 'cashier']::public.user_role[])
  );
