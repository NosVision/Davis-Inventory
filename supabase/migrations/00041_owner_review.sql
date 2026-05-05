-- ============================================================================
-- 00041_owner_review.sql
--
-- Owner review workflow — combines daily comparison results with the SOP's
-- penalty taxonomy so the owner / manager can do the entire post-count
-- review (recount, conclude, assign responsibility, attach a penalty,
-- escalate to HR) on one page.
--
-- Mirrors the manual Excel "Upper House_INVENTORY" sheet the manager keeps
-- today. Adds:
--   • per-comparison recount + conclusion + responsibility + HR escalation
--   • a master `penalty_codes` table seeded from the SOP (A-01..S-01, EXP-01)
--   • per-penalty link back to the comparison + month bucket so we can
--     count violations toward the 12/month quota the SOP defines
--   • view `v_monthly_violation_count` for the quota counter UI
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Extend `comparisons`
-- ----------------------------------------------------------------------------
-- Recount = "นับตรวจสอบโดย N" in the Excel sheet. Stored inline (one round
-- of recount per row) to keep the UI simple — see CLAUDE/discussion: option
-- A. If we later need multiple recounts we'll spin up a sibling table.

ALTER TABLE public.comparisons
  ADD COLUMN IF NOT EXISTS recount_quantity NUMERIC,
  ADD COLUMN IF NOT EXISTS recount_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS recount_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recount_notes TEXT,
  ADD COLUMN IF NOT EXISTS conclusion TEXT,
  ADD COLUMN IF NOT EXISTS responsible_staff_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS escalated_to_hr_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_by UUID REFERENCES public.profiles(id);

-- ----------------------------------------------------------------------------
-- 2. Master `penalty_codes` — seeded from the SOP
-- ----------------------------------------------------------------------------
-- `level` describes how the punishment lands ('notify', 'suspend', 'fine',
-- 'compensate', 'terminate'). `default_amount` is suggested THB the UI
-- pre-fills when the owner attaches the code; nullable for non-monetary
-- punishments. `included_in_quota` controls whether the violation counts
-- toward the 12/month threshold — EXP-01 explicitly does NOT.

CREATE TABLE IF NOT EXISTS public.penalty_codes (
  code              TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  description       TEXT,
  default_amount    NUMERIC,
  level             TEXT NOT NULL CHECK (level IN ('notify','suspend','fine','compensate','terminate')),
  included_in_quota BOOLEAN NOT NULL DEFAULT true,
  active            BOOLEAN NOT NULL DEFAULT true,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Seed (idempotent — re-running the migration won't duplicate).
INSERT INTO public.penalty_codes (code, label, description, default_amount, level, included_in_quota, sort_order)
VALUES
  ('A-01', 'สต็อกไม่เป็นระเบียบ / หาของยาก',           'จัดเรียงไม่เรียบร้อย ค้นของยาก',                 NULL, 'notify',     true, 1),
  ('A-02', 'สต็อกไม่ตรง (ประมาท / ลืมลงยอด)',         'ครั้งที่ 2: หัก 300 บาท | ครั้งที่ 3: หัก 500 บาท', 300,  'fine',       true, 2),
  ('A-03', 'นับสต็อกปลอม / ข้อมูลไม่ตรงจริง',          'Ghost counting — หักคนละ 500 บาท (หรือ 2 เท่าหากระบุคนทำได้)', 500, 'fine', true, 3),
  ('A-04', 'จัดสต็อก ENT ผิด / ไม่ติดสติกเกอร์เขียว',  'ENT ทุกขวดต้องมีสติกเกอร์เขียว',                NULL, 'notify',     true, 4),
  ('A-05', 'Pre-batch ไม่มีโพสอิทแปะข้อมูล',           'ต้องระบุประเภทเหล้า + ปริมาณคงเหลือ',           NULL, 'notify',     true, 5),
  ('P-01', 'ทำใบ PR ผิดเวลา / สั่งของช่วงออดิท',       'ระงับสิทธิ์เบิกเหล้าทันที',                     NULL, 'suspend',    true, 6),
  ('M-01', 'สินค้าขาดหาย (Missing)',                  'หักตามราคาต้นทุนสินค้า',                       NULL, 'compensate', true, 7),
  ('S-01', 'เจตนาทุจริต / ปิดบังหลักฐาน',              'เลิกจ้างทันที',                                NULL, 'terminate',  true, 8),
  ('EXP-01','ส่งเหล้าหมดอายุคืนช้ากว่า 18:20 น. (วันอังคาร)', 'ปรับ 100 บาท / วัน — ไม่นับใน quota',     100,  'fine',       false, 9)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description,
      default_amount = EXCLUDED.default_amount,
      level = EXCLUDED.level,
      included_in_quota = EXCLUDED.included_in_quota,
      sort_order = EXCLUDED.sort_order;

-- penalty_codes is a small reference table, fine for everyone to read.
ALTER TABLE public.penalty_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read penalty codes" ON public.penalty_codes;
CREATE POLICY "Anyone can read penalty codes" ON public.penalty_codes
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admin can manage penalty codes" ON public.penalty_codes;
CREATE POLICY "Admin can manage penalty codes" ON public.penalty_codes
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- 3. Extend `penalties`
-- ----------------------------------------------------------------------------
-- Existing schema (id, store_id, staff_id, reason, amount, status,
-- approved_by, notes, created_at) keeps its semantics. We add:
--   • penalty_code → master row (rule + level)
--   • comparison_id → which discrepancy triggered it (nullable so EXP-01
--                     and ad-hoc penalties without a comparison still fit)
--   • month_year → 'YYYY-MM' so the quota query is index-friendly
--   • included_in_quota → snapshot from the master at creation time so the
--                         quota count stays stable even if rules change later

ALTER TABLE public.penalties
  ADD COLUMN IF NOT EXISTS penalty_code TEXT REFERENCES public.penalty_codes(code),
  ADD COLUMN IF NOT EXISTS comparison_id UUID REFERENCES public.comparisons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS month_year TEXT,
  ADD COLUMN IF NOT EXISTS included_in_quota BOOLEAN NOT NULL DEFAULT true;

-- Auto-populate month_year from created_at on insert. Lets the UI insert
-- without thinking about it and keeps the value monotonic with the row.
CREATE OR REPLACE FUNCTION public.set_penalty_month_year()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.month_year IS NULL THEN
    NEW.month_year := to_char(COALESCE(NEW.created_at, now()) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_penalties_set_month ON public.penalties;
CREATE TRIGGER trg_penalties_set_month
  BEFORE INSERT ON public.penalties
  FOR EACH ROW EXECUTE FUNCTION public.set_penalty_month_year();

-- Backfill month_year for existing rows (penalties is empty today but
-- run-once just in case the migration is re-applied after seeding).
UPDATE public.penalties
   SET month_year = to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM')
 WHERE month_year IS NULL;

-- Indexes that the owner-review page hits hardest.
CREATE INDEX IF NOT EXISTS idx_penalties_store_month
  ON public.penalties(store_id, month_year);
CREATE INDEX IF NOT EXISTS idx_penalties_comparison
  ON public.penalties(comparison_id);
CREATE INDEX IF NOT EXISTS idx_penalties_staff_month
  ON public.penalties(staff_id, month_year);

-- Manager isn't covered by is_admin() but legitimately runs this workflow
-- inside their assigned stores. Add a manager-of-store policy alongside the
-- existing admin-only one so the owner-review page works for managers too.
DROP POLICY IF EXISTS "Manager manage store penalties" ON public.penalties;
CREATE POLICY "Manager manage store penalties" ON public.penalties
  FOR ALL
  USING (
    store_id IN (SELECT public.get_user_store_ids())
    AND EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND role IN ('manager', 'owner', 'accountant', 'hq')
    )
  )
  WITH CHECK (
    store_id IN (SELECT public.get_user_store_ids())
    AND EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND role IN ('manager', 'owner', 'accountant', 'hq')
    )
  );

-- ----------------------------------------------------------------------------
-- 4. Monthly violation count view
-- ----------------------------------------------------------------------------
-- Powers the "X / 12 ครั้ง" badge. Only counts penalties that were marked
-- as included_in_quota at creation (so EXP-01 is excluded automatically).

CREATE OR REPLACE VIEW public.v_monthly_violation_count AS
SELECT
  store_id,
  staff_id,
  month_year,
  COUNT(*) AS violations,
  SUM(COALESCE(amount, 0)) AS total_amount
FROM public.penalties
WHERE included_in_quota = true
  AND status <> 'cancelled'
GROUP BY store_id, staff_id, month_year;

-- Views inherit RLS from underlying tables, but we still want the API to
-- be able to select. No extra grants needed beyond the existing penalties
-- policies.

-- ----------------------------------------------------------------------------
-- 5. Indexes for the new comparison columns
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_comparisons_responsible
  ON public.comparisons(responsible_staff_id)
  WHERE responsible_staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comparisons_escalated
  ON public.comparisons(escalated_to_hr_at)
  WHERE escalated_to_hr_at IS NOT NULL;

COMMIT;
