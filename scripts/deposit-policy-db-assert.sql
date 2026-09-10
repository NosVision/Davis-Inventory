-- Run inside BEGIN ... ROLLBACK. Creates no lasting customer records or notifications.
do $$
declare s uuid; dep uuid; vip_dep uuid; w1 uuid; w2 uuid; owner_id uuid; chat_id uuid;
begin
  if private.deposit_collection_deadline('2026-09-30 23:59:59+07') <> '2026-10-01 04:00:00+07'::timestamptz then raise exception 'normal deadline failed'; end if;
  if private.deposit_collection_deadline('2026-10-02 23:59:59+07') <> '2026-10-05 04:00:00+07'::timestamptz then raise exception 'Friday extension failed'; end if;
  if private.deposit_collection_deadline('2026-10-03 23:59:59+07') <> '2026-10-05 04:00:00+07'::timestamptz then raise exception 'Saturday extension failed'; end if;
  select id into s from public.stores limit 1;
  select id into owner_id from public.profiles where role = 'owner' limit 1;
  if owner_id is null then raise exception 'owner fixture unavailable'; end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',owner_id,'role','authenticated')::text, true);

  insert into public.deposits(store_id,deposit_code,customer_name,product_name,quantity,remaining_qty,status,expiry_date,terms_accepted_at,terms_version,terms_locale)
  values(s,'TEST-DEADLINE-'||gen_random_uuid(),'TEST','TEST',2,2,'in_store',now()+interval '30 days',now(),'2026-09-10','th') returning id into dep;
  insert into public.withdrawals(deposit_id,store_id,requested_qty,status) values(dep,s,1,'pending') returning id into w1;
  insert into public.withdrawals(deposit_id,store_id,requested_qty,status) values(dep,s,1,'pending') returning id into w2;
  -- A failed group must leave its valid sibling pending.
  update public.withdrawals set bottle_id=(select id from public.deposit_bottles where deposit_id=dep order by bottle_no limit 1) where id=w1;
  begin
    perform public.complete_deposit_withdrawals(jsonb_build_array(jsonb_build_object('id',w1,'actual_qty',0.5)));
    raise exception 'fractional linked bottle was accepted';
  exception when raise_exception then
    if SQLERRM <> 'Linked bottle quantity must be zero or one' then raise; end if;
  end;
  if (select remaining_qty from public.deposits where id=dep) <> 2 then raise exception 'invalid quantity changed inventory'; end if;
  update public.withdrawals set bottle_id=null where id=w1;
  begin
    perform public.complete_deposit_withdrawals(jsonb_build_array(jsonb_build_object('id',w1,'actual_qty',1),jsonb_build_object('id',gen_random_uuid(),'actual_qty',1)));
    raise exception 'missing sibling was accepted';
  exception when raise_exception then
    if SQLERRM <> 'Withdrawal changed or access denied' then raise; end if;
  end;
  if (select status::text from public.withdrawals where id=w1) <> 'pending' then raise exception 'partial completion'; end if;
  begin
    perform public.complete_deposit_withdrawals(jsonb_build_array(jsonb_build_object('id',w1,'actual_qty',1)), p_chat_message_id => gen_random_uuid());
    raise exception 'invalid chat card accepted';
  exception when raise_exception then
    if SQLERRM <> 'Withdrawal chat card changed or access denied' then raise; end if;
  end;
  if (select status::text from public.withdrawals where id=w1) <> 'pending' then raise exception 'chat failure partially completed withdrawal'; end if;
  insert into public.chat_messages(room_id,type,content,metadata)
  values((select id from public.chat_rooms limit 1),'action_card','TEST',jsonb_build_object(
    'action_type','withdrawal_claim','reference_table','withdrawals','status','claimed',
    'reference_id',(select deposit_code from public.deposits where id=dep))) returning id into chat_id;
  perform public.complete_deposit_withdrawals(jsonb_build_array(jsonb_build_object('id',w1,'actual_qty',1),jsonb_build_object('id',w2,'actual_qty',1)),p_chat_message_id=>chat_id);
  if (select metadata->>'status' from public.chat_messages where id=chat_id) <> 'completed' then raise exception 'chat completion not committed with withdrawal'; end if;
  if (select count(*) from public.withdrawals where id in (w1,w2) and status='completed') <> 2 then raise exception 'valid completion failed'; end if;
  if (select remaining_qty from public.deposits where id=dep) <> 0 then raise exception 'inventory not committed'; end if;
  if (select count(*) from public.deposit_bottles where deposit_id=dep and status='consumed') <> 2 then raise exception 'bottles not consumed'; end if;

  -- Requests submitted on time still cannot be completed after the final deadline.
  update public.deposits set remaining_qty=1,status='in_store' where id=dep;
  insert into public.withdrawals(deposit_id,store_id,requested_qty,status) values(dep,s,1,'pending') returning id into w1;
  update public.deposits set expiry_date=now()-interval '10 days' where id=dep;
  begin
    perform public.complete_deposit_withdrawals(jsonb_build_array(jsonb_build_object('id',w1,'actual_qty',1)));
    raise exception 'expired completion was accepted';
  exception when check_violation then
    if SQLERRM not like 'DEPOSIT_EXPIRED:%' then raise; end if;
  end;
  begin
    insert into public.withdrawals(deposit_id,store_id,requested_qty,status) values(dep,s,1,'pending');
    raise exception 'expired request was accepted';
  exception when check_violation then
    if SQLERRM not like 'DEPOSIT_EXPIRED:%' then raise; end if;
  end;
  update public.withdrawals set status='rejected' where id=w1;
  -- Neither direct deadline edits nor edits to the agreement can extend entitlement.
  update public.deposits set collection_deadline_at=now()+interval '1 year' where id=dep;
  if (select collection_deadline_at>now() from public.deposits where id=dep) then raise exception 'deadline editable'; end if;
  begin
    update public.deposits set terms_locale='en' where id=dep;
    raise exception 'consent editable';
  exception when check_violation then null;
  end;
  -- VIP is deliberately exempt, including imported rows with an old nominal expiry.
  insert into public.deposits(store_id,deposit_code,customer_name,product_name,quantity,remaining_qty,status,expiry_date,is_vip)
  values(s,'TEST-VIP-'||gen_random_uuid(),'TEST','TEST',0,1,'in_store',now()-interval '10 days',true) returning id into vip_dep;
  insert into public.withdrawals(deposit_id,store_id,requested_qty,status) values(vip_dep,s,1,'pending');
  if (select collection_deadline_at is not null from public.deposits where id=vip_dep) then raise exception 'VIP deadline set'; end if;
end;
$$;
select 'PASS: deadline, weekend extension, consent, atomic completion, expired request/fulfilment, VIP' as result;

-- Exercise actual authenticated/RLS execution, not only the database owner path.
do $$
declare owner_id uuid; s uuid; d uuid; w uuid;
begin
  select p.id, us.store_id into owner_id, s from public.profiles p
    join public.user_stores us on us.user_id=p.id where p.role in ('bar','head_bar') limit 1;
  if owner_id is null then raise exception 'bar fixture unavailable'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  insert into public.deposits(store_id,deposit_code,customer_name,product_name,quantity,remaining_qty,status,expiry_date)
  values(s,'TEST-RLS-'||gen_random_uuid(),'TEST','TEST',1,1,'in_store',now()+interval '30 days') returning id into d;
  insert into public.withdrawals(deposit_id,store_id,requested_qty,status,bottle_id)
    values(d,s,1,'pending',(select id from public.deposit_bottles where deposit_id=d limit 1)) returning id into w;
  perform set_config('deposit_test.withdrawal_id',w::text,true);
end;
$$;
set local role authenticated;
do $$
declare w uuid := current_setting('deposit_test.withdrawal_id')::uuid;
begin
  perform public.complete_deposit_withdrawals(jsonb_build_array(jsonb_build_object('id',w,'actual_qty',1)));
  if (select status::text from public.withdrawals where id=w) <> 'completed' then raise exception 'authenticated completion failed'; end if;
  if (select d.remaining_qty from public.deposits d join public.withdrawals x on x.deposit_id=d.id where x.id=w) <> 0 then raise exception 'authenticated inventory update failed'; end if;
end;
$$;
reset role;
do $$
begin
  if has_function_privilege('anon','public.complete_deposit_withdrawals(jsonb,text,text,uuid)','execute') then raise exception 'anonymous RPC access'; end if;
end;
$$;
select 'PASS: authenticated bar RLS completion; anonymous RPC denied' as result;
