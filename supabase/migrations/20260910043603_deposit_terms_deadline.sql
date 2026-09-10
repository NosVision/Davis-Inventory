-- Shared deadline and consent evidence. Existing deposits retain their nominal expiry dates.
create schema if not exists private;

create or replace function private.deposit_collection_deadline(p_expiry timestamptz, p_blocked text[] default array['Fri','Sat'])
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare
  last_night date := (p_expiry at time zone 'Asia/Bangkok')::date;
  day_names text[] := array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  added integer := 0;
begin
  if p_expiry is null then return null; end if;
  while day_names[extract(dow from last_night)::integer + 1] = any(coalesce(p_blocked, array['Fri','Sat'])) and added < 7 loop
    last_night := last_night + 1;
    added := added + 1;
  end loop;
  return (last_night + 1 + time '04:00') at time zone 'Asia/Bangkok';
end;
$$;

alter table public.deposits
  add column if not exists collection_deadline_at timestamptz,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists terms_locale text;

-- Snapshot each store's blocked days. Changing opening hours cannot move this deadline.
update public.deposits d set collection_deadline_at = case when d.is_vip then null else
  private.deposit_collection_deadline(d.expiry_date,
    (select s.withdrawal_blocked_days from public.store_settings s where s.store_id = d.store_id)) end;

create or replace function private.set_deposit_collection_deadline()
returns trigger language plpgsql security definer set search_path = '' as $$
declare blocked text[];
begin
  if TG_OP = 'UPDATE' then
    if old.terms_accepted_at is not null and
       (new.terms_accepted_at, new.terms_version, new.terms_locale) is distinct from
       (old.terms_accepted_at, old.terms_version, old.terms_locale) then
      raise exception 'Deposit consent evidence cannot be changed' using errcode = '23514';
    end if;
    if (new.expiry_date, new.store_id, new.is_vip) is not distinct from
       (old.expiry_date, old.store_id, old.is_vip) then
      new.collection_deadline_at := old.collection_deadline_at;
      return new;
    end if;
  end if;
  select s.withdrawal_blocked_days into blocked from public.store_settings s where s.store_id = new.store_id;
  new.collection_deadline_at := case when new.is_vip then null else
    private.deposit_collection_deadline(new.expiry_date, blocked) end;
  return new;
end;
$$;

create trigger deposit_collection_deadline_before_write
before insert or update on public.deposits for each row
execute function private.set_deposit_collection_deadline();

alter table public.deposits add constraint deposit_terms_evidence_complete check (
  (terms_accepted_at is null and terms_version is null and terms_locale is null) or
  (terms_accepted_at is not null and terms_version is not null and terms_locale is not null and terms_locale in ('th','en'))
);

-- Covers customer API, staff direct writes, and requests submitted before the deadline.
-- Rejections/cancellations remain possible after expiry.
create or replace function private.guard_withdrawal_collection_deadline()
returns trigger language plpgsql security definer set search_path = '' as $$
declare dep public.deposits%rowtype;
begin
  if new.status::text not in ('pending','approved','completed') then return new; end if;
  if TG_OP = 'UPDATE' and new.status is not distinct from old.status and new.deposit_id is not distinct from old.deposit_id then
    return new;
  end if;
  select * into dep from public.deposits where id = new.deposit_id for update;
  if not found then raise exception 'Deposit not found' using errcode = '23514'; end if;
  if dep.status::text in ('expired','transferred_out','transfer_pending','cancelled','withdrawn') or
     (dep.collection_deadline_at is not null and clock_timestamp() >= dep.collection_deadline_at) then
    raise exception 'DEPOSIT_EXPIRED: สิ้นสุดสิทธิ์การเบิกแล้ว / Collection deadline passed'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger withdrawal_collection_deadline_before_write
before insert or update on public.withdrawals for each row
execute function private.guard_withdrawal_collection_deadline();

revoke all on function private.deposit_collection_deadline(timestamptz,text[]) from public, anon, authenticated, service_role;
revoke all on function private.set_deposit_collection_deadline() from public, anon, authenticated, service_role;
revoke all on function private.guard_withdrawal_collection_deadline() from public, anon, authenticated, service_role;

-- Invoker permissions retain the existing RLS rules; all rows succeed or all roll back.
create or replace function public.complete_deposit_withdrawals(p_rows jsonb, p_notes text default null, p_photo_url text default null, p_chat_message_id uuid default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare expected integer; changed integer; distinct_deposits integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Invalid withdrawal rows'; end if;
  expected := jsonb_array_length(p_rows);
  if expected = 0 or expected > 100 then raise exception 'Invalid withdrawal count'; end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as r(id uuid, actual_qty numeric)
             where r.id is null or r.actual_qty is null or r.actual_qty < 0 or r.actual_qty::text in ('NaN','Infinity','-Infinity')) then
    raise exception 'Invalid withdrawal quantity';
  end if;
  select count(distinct w.deposit_id) into distinct_deposits
  from public.withdrawals w join jsonb_to_recordset(p_rows) as r(id uuid, actual_qty numeric) on r.id = w.id;
  if distinct_deposits <> 1 then raise exception 'Withdrawals must belong to one deposit'; end if;
  update public.withdrawals w set status = 'completed', actual_qty = r.actual_qty,
    processed_by = auth.uid(), notes = coalesce(p_notes, r.notes, w.notes), photo_url = coalesce(p_photo_url, r.photo_url, w.photo_url)
  from jsonb_to_recordset(p_rows) as r(id uuid, actual_qty numeric, notes text, photo_url text)
  where w.id = r.id and w.status::text in ('pending','approved');
  get diagnostics changed = row_count;
  if changed <> expected then raise exception 'Withdrawal changed or access denied'; end if;
  -- The chat card is committed with the withdrawal so a lost later UI update is recoverable.
  if p_chat_message_id is not null then
    update public.chat_messages m set metadata = m.metadata || jsonb_build_object(
      'status', 'completed', 'completed_by', auth.uid(), 'completed_at', clock_timestamp(),
      'completed_by_name', (select coalesce(p.display_name,p.username) from public.profiles p where p.id=auth.uid()))
    where m.id=p_chat_message_id and m.metadata->>'action_type'='withdrawal_claim'
      and m.metadata->>'reference_table'='withdrawals'
      and m.metadata->>'reference_id' = (
        select d.deposit_code from public.deposits d
        join public.withdrawals w on w.deposit_id=d.id
        where w.id=(p_rows->0->>'id')::uuid
      );
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'Withdrawal chat card changed or access denied'; end if;
  end if;
end;
$$;
revoke all on function public.complete_deposit_withdrawals(jsonb,text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.complete_deposit_withdrawals(jsonb,text,text,uuid) to authenticated;
