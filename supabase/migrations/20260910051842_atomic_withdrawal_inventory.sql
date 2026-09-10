-- Invoker permissions retain the existing RLS rules; all rows succeed or all roll back.
create or replace function public.complete_deposit_withdrawals(p_rows jsonb, p_notes text default null, p_photo_url text default null, p_chat_message_id uuid default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare expected integer; changed integer; distinct_deposits integer; dep public.deposits%rowtype; total_qty numeric; legacy_qty numeric; remaining numeric; level numeric; next_status public.deposit_status;
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
  select d.* into dep from public.deposits d join public.withdrawals w on w.deposit_id=d.id
    where w.id=(p_rows->0->>'id')::uuid for update of d;
  if not found then raise exception 'Deposit inaccessible'; end if;
  select sum(r.actual_qty) into total_qty from jsonb_to_recordset(p_rows) as r(id uuid, actual_qty numeric);
  if total_qty <= 0 or total_qty > dep.remaining_qty then raise exception 'Invalid remaining quantity'; end if;
  remaining := greatest(0,dep.remaining_qty-total_qty);

  update public.deposit_bottles b set status='consumed', remaining_percent=0,
    consumed_at=clock_timestamp(), consumed_by=auth.uid()
  where b.deposit_id=dep.id and b.id in (
    select w.bottle_id from public.withdrawals w join jsonb_to_recordset(p_rows) as r(id uuid, actual_qty numeric) on r.id=w.id
    where r.actual_qty > 0 and w.bottle_id is not null
  );
  -- Legacy whole-bottle requests have no bottle_id; consume their FIFO slots, if present.
  select coalesce(sum(r.actual_qty),0) into legacy_qty from public.withdrawals w
    join jsonb_to_recordset(p_rows) as r(id uuid, actual_qty numeric) on r.id=w.id where w.bottle_id is null;
  if legacy_qty > 0 and legacy_qty=trunc(legacy_qty) then
    update public.deposit_bottles b set status='consumed', remaining_percent=0,
      consumed_at=clock_timestamp(), consumed_by=auth.uid()
    where b.id in (select id from public.deposit_bottles where deposit_id=dep.id and status<>'consumed'
      order by bottle_no limit legacy_qty::integer);
  end if;
  if remaining=0 then
    update public.deposit_bottles set status='consumed', remaining_percent=0,
      consumed_at=clock_timestamp(), consumed_by=auth.uid() where deposit_id=dep.id and status<>'consumed';
  end if;
  select avg(remaining_percent) into level from public.deposit_bottles where deposit_id=dep.id and status<>'consumed';
  next_status := case when remaining=0 then 'withdrawn'::public.deposit_status
    when exists(select 1 from public.withdrawals where deposit_id=dep.id and status::text in ('pending','approved')) then 'pending_withdrawal'::public.deposit_status
    else 'in_store'::public.deposit_status end;
  update public.deposits set remaining_qty=remaining,
    remaining_percent=case when remaining=0 then 0 else coalesce(level, case when dep.quantity>0 then remaining/dep.quantity*100 else dep.remaining_percent end) end,
    status=next_status where id=dep.id;
  get diagnostics changed = row_count;
  if changed<>1 then raise exception 'Deposit update denied'; end if;

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
