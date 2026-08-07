-- 00180_clear_uncounted_pos_backlog.sql
-- One-off data fix, applied to production 2026-08-07.
--
-- Closes the POS-only backlog that predates the "ไม่ได้นับ (POS มีขาย)" tab: 157 rows across all
-- four venues (24 BLVD 73 · House of Savoy 42 · Upper House 27 · Baccarat 15), dating back to
-- 2026-05-03.
--
-- What they are: POS recorded a sale with no manual count behind it. Stock had been moved from
-- another venue and sold without ever being received in, so it was not on the count sheet — the
-- comparison then reads 0 − posQty and goes negative. They piled up unseen because the
-- explanation page filtered out every row with no manual count, so nobody could act on them even
-- though they sat at status='pending'.
--
-- HQ has reviewed and accepted the whole backlog (owner decision 2026-08-07). Going forward the
-- new tab surfaces these as they happen and staff write the explanation themselves; there is no
-- point demanding a retroactive one for months-old movements nobody can now reconstruct.
--
-- Marked 'approved' rather than deleted so the numbers stay auditable — they just stop asking for
-- an explanation. Deliberately narrow: rows that already carry an explanation keep it, and
-- anything WITH a manual count (a real counted variance) is untouched.
--
-- Idempotent: re-running matches nothing, because the rows are no longer 'pending'.
update public.comparisons
set status = 'approved',
    explanation = coalesce(
      nullif(explanation, ''),
      'เคลียร์ยกชุด 2026-08-07 — HQ รับทราบแล้ว (ของเบิกข้ามสาขาที่ไม่ได้รับเข้าก่อนเริ่มใช้แท็บ "ไม่ได้นับ")'
    )
where status = 'pending'
  and manual_quantity is null
  and difference <> 0;
