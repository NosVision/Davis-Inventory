-- 00203_fix_dayoff_swaps_2026_09_11.sql
-- Correct the three House of Savoy swaps that 00088's cell exchange applied to the wrong person
-- (see 00202). Filed 11/09/2026 by Wut Savoy with พาย ชัน and approved the same afternoon:
--   09 ↔ 12 · 13 ↔ 16 · 18 ↔ 19
-- The exchange left Wut working all six days and พาย off on 12/16/19. Under 00202's rule Wut moves
-- his day off to 12/16/19, and พาย — rostered to work all six days before the swaps — keeps her
-- original roster. Decided by the owner 2026-09-13.
--
-- Because the exchange is its own inverse, the pre-approval roster is known exactly: พาย's shift on
-- 12/16/19 is the one the exchange parked on Wut's 9/13/18, and Wut's own shift is still on his
-- 12/16/19.
--
-- Guarded: runs only while all nine cells are still exactly as the wrong approval left them, so a
-- roster someone has since fixed by hand is never overwritten.

do $$
declare
  wut constant uuid := '81224fc0-5aad-4c27-bcfa-cdf5f363aa7a';
  pai constant uuid := '5c7a61b2-5d86-4ce7-93ce-eebcfc3ff94c';
  matched int;
begin
  select count(*) into matched
  from public.hr_schedule
  where (user_id = wut
         and work_date = any (array['2026-09-09', '2026-09-12', '2026-09-13', '2026-09-16', '2026-09-18', '2026-09-19']::date[])
         and not is_day_off)
     or (user_id = pai
         and work_date = any (array['2026-09-12', '2026-09-16', '2026-09-19']::date[])
         and is_day_off);
  if matched <> 9 then
    raise exception 'dayoff swap fix: roster no longer matches the wrong approval (% of 9 cells) — fix by hand', matched;
  end if;

  -- 1. พาย works 12/16/19 again, on the shift the exchange moved onto Wut's 9/13/18.
  update public.hr_schedule p
     set is_day_off = false, shift_template_id = w.shift_template_id
    from public.hr_schedule w,
         (values ('2026-09-12'::date, '2026-09-09'::date),
                 ('2026-09-16'::date, '2026-09-13'::date),
                 ('2026-09-19'::date, '2026-09-18'::date)) as pair(pai_day, wut_day)
   where p.user_id = pai and p.work_date = pair.pai_day
     and w.user_id = wut and w.work_date = pair.wut_day;

  -- 2. Wut works 9/13/18 on his own shift, taken from his 12/16/19 before those become days off.
  update public.hr_schedule a
     set is_day_off = false, shift_template_id = b.shift_template_id
    from public.hr_schedule b,
         (values ('2026-09-09'::date, '2026-09-12'::date),
                 ('2026-09-13'::date, '2026-09-16'::date),
                 ('2026-09-18'::date, '2026-09-19'::date)) as pair(work_day, off_day)
   where a.user_id = wut and a.work_date = pair.work_day
     and b.user_id = wut and b.work_date = pair.off_day;

  -- 3. Wut is off on 12/16/19.
  update public.hr_schedule
     set is_day_off = true, shift_template_id = null
   where user_id = wut
     and work_date = any (array['2026-09-12', '2026-09-16', '2026-09-19']::date[]);

  update public.hr_dayoff_swaps
     set decision_note = concat_ws(' · ', decision_note,
           'แก้ตาราง 13/09/2026: ระบบเดิมย้ายวันหยุดไปให้เพื่อนร่วมงาน — คืนวันหยุดให้ผู้ขอแล้ว')
   where id = any (array[
     'de4f675e-99a7-4710-8a43-03276a0bbe9c',
     'd8065738-ee4f-47f0-8f47-55b6b905e8bf',
     '36f30858-3d7b-4f33-ae83-3aeb997d5f58'
   ]::uuid[]);

  insert into public.hr_audit_log (actor_id, action, table_name, record_id, before, after, reason)
  select null, 'update', 'hr_dayoff_swaps', x.id,
         jsonb_build_object('requester_off', x.from_day, 'counterpart_off', x.to_day),
         jsonb_build_object('requester_off', x.to_day, 'counterpart_off', null),
         'Corrected by migration 00203: the 00088 exchange gave the requester''s day off to the counterpart'
  from (values
    ('de4f675e-99a7-4710-8a43-03276a0bbe9c'::uuid, '2026-09-09'::date, '2026-09-12'::date),
    ('d8065738-ee4f-47f0-8f47-55b6b905e8bf'::uuid, '2026-09-13'::date, '2026-09-16'::date),
    ('36f30858-3d7b-4f33-ae83-3aeb997d5f58'::uuid, '2026-09-18'::date, '2026-09-19'::date)
  ) as x(id, from_day, to_day);
end;
$$;
