-- HR Leave Types & Holidays (P3.1)
-- Part of Davis Inventory HR System
-- §E: Leave management with Thai standard leave types
-- NOTE (Round 20 reconcile): this file was applied inline via apply_migration
-- (migration version "hr_leave_types_holidays"); the on-disk copy is corrected here
-- to fix a `THEN THEN` syntax error and garbled Thai seed strings so fresh deploys match live.

-- Leave Types Table
-- Stores configurable leave types (ลาป่วย, ลากิจ, ลาพักร้อน, etc.)
CREATE TABLE IF NOT EXISTS hr_leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES hr_companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE, -- e.g., 'sick', 'personal', 'vacation'
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  paid BOOLEAN NOT NULL DEFAULT true, -- Paid leave vs unpaid
  requires_cert BOOLEAN NOT NULL DEFAULT false, -- Medical certificate required
  requires_reason BOOLEAN NOT NULL DEFAULT true, -- Reason required
  annual_quota_days INTEGER CHECK (annual_quota_days IS NULL OR annual_quota_days > 0), -- Days per year (NULL = unlimited)
  max_consecutive_days INTEGER CHECK (max_consecutive_days IS NULL OR max_consecutive_days > 0), -- Max days in a row
  probational_allowed BOOLEAN NOT NULL DEFAULT false, -- Can be used during probation
  advance_notice_days INTEGER CHECK (advance_notice_days IS NULL OR advance_notice_days >= 0), -- Days notice required
  paid_percent INTEGER CHECK (paid_percent IS NULL OR (paid_percent >= 0 AND paid_percent <= 100)), -- % pay when approved (NULL = use paid flag)
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

-- Holidays Table (Public holidays observed by the company)
CREATE TABLE IF NOT EXISTS hr_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES hr_companies(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  is_public_holiday BOOLEAN NOT NULL DEFAULT true, -- Govt-mandated public holiday
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE(company_id, holiday_date)
);

-- Indexes for lookups
CREATE INDEX IF NOT EXISTS hr_leave_types_company_active ON hr_leave_types(company_id, active, sort_order);
CREATE INDEX IF NOT EXISTS hr_leave_types_code ON hr_leave_types(code);
CREATE INDEX IF NOT EXISTS hr_holidays_company_date ON hr_holidays(company_id, holiday_date);

-- RLS Policies
ALTER TABLE hr_leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_holidays ENABLE ROW LEVEL SECURITY;

-- Leave Types: read = any authenticated (ESS needs to list types to file leave);
-- write = can_manage_hr
CREATE POLICY hr_leave_types_read_policy ON hr_leave_types
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY hr_leave_types_write_policy ON hr_leave_types
  FOR ALL
  TO authenticated
  USING (can_manage_hr())
  WITH CHECK (can_manage_hr());

-- Holidays: read = any authenticated; write = can_manage_hr
CREATE POLICY hr_holidays_read_policy ON hr_holidays
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY hr_holidays_write_policy ON hr_holidays
  FOR ALL
  TO authenticated
  USING (can_manage_hr())
  WITH CHECK (can_manage_hr());

-- Seed Thai Standard Leave Types + 13 public holidays for the test company
DO $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT id INTO v_company_id FROM hr_companies WHERE name = 'HR Test Co' LIMIT 1;

  IF v_company_id IS NOT NULL THEN
    -- ลาป่วย (Sick Leave) - Paid, requires cert after 3 consecutive days
    INSERT INTO hr_leave_types (company_id, code, name_th, name_en, paid, requires_cert, annual_quota_days, probational_allowed, sort_order)
    VALUES (v_company_id, 'sick', 'ลาป่วย', 'Sick Leave', true, true, 30, true, 1)
    ON CONFLICT (code) DO NOTHING;

    -- ลากิจ (Personal Leave) - Paid
    INSERT INTO hr_leave_types (company_id, code, name_th, name_en, paid, annual_quota_days, probational_allowed, sort_order)
    VALUES (v_company_id, 'personal', 'ลากิจ', 'Personal Leave', true, 3, true, 2)
    ON CONFLICT (code) DO NOTHING;

    -- ลาพักร้อน (Vacation / Annual Leave) - Paid, advance notice
    INSERT INTO hr_leave_types (company_id, code, name_th, name_en, paid, annual_quota_days, advance_notice_days, probational_allowed, sort_order)
    VALUES (v_company_id, 'vacation', 'ลาพักร้อน', 'Vacation Leave', true, 6, 7, false, 3)
    ON CONFLICT (code) DO NOTHING;

    -- ลาคลอด (Maternity Leave) - Paid, 98 days by law
    INSERT INTO hr_leave_types (company_id, code, name_th, name_en, paid, requires_cert, annual_quota_days, probational_allowed, sort_order)
    VALUES (v_company_id, 'maternity', 'ลาคลอด', 'Maternity Leave', true, true, 98, true, 4)
    ON CONFLICT (code) DO NOTHING;

    -- ลาช่วยภริยาคลอดบุตร (Paternity Leave)
    INSERT INTO hr_leave_types (company_id, code, name_th, name_en, paid, annual_quota_days, probational_allowed, sort_order)
    VALUES (v_company_id, 'paternity', 'ลาช่วยภริยาคลอดบุตร', 'Paternity Leave', true, 15, true, 5)
    ON CONFLICT (code) DO NOTHING;

    -- ลาสมรส (Marriage Leave)
    INSERT INTO hr_leave_types (company_id, code, name_th, name_en, paid, annual_quota_days, probational_allowed, sort_order)
    VALUES (v_company_id, 'marriage', 'ลาสมรส', 'Marriage Leave', true, 3, true, 6)
    ON CONFLICT (code) DO NOTHING;

    -- ลางานศพ (Bereavement Leave)
    INSERT INTO hr_leave_types (company_id, code, name_th, name_en, paid, annual_quota_days, probational_allowed, sort_order)
    VALUES (v_company_id, 'bereavement', 'ลางานศพ', 'Bereavement Leave', true, 15, true, 7)
    ON CONFLICT (code) DO NOTHING;

    -- ลาเกณฑ์ทหาร (Military Service) - Unpaid, by law
    INSERT INTO hr_leave_types (company_id, code, name_th, name_en, paid, probational_allowed, sort_order)
    VALUES (v_company_id, 'military', 'ลาเกณฑ์ทหาร', 'Military Service Leave', false, true, 8)
    ON CONFLICT (code) DO NOTHING;

    -- ลาฝึกอบรม (Training Leave)
    INSERT INTO hr_leave_types (company_id, code, name_th, name_en, paid, annual_quota_days, probational_allowed, sort_order)
    VALUES (v_company_id, 'training', 'ลาฝึกอบรม', 'Training Leave', true, 5, true, 9)
    ON CONFLICT (code) DO NOTHING;

    -- ลากิจกรณีพิเศษ (Special Leave)
    INSERT INTO hr_leave_types (company_id, code, name_th, name_en, paid, annual_quota_days, probational_allowed, sort_order)
    VALUES (v_company_id, 'special', 'ลากิจกรณีพิเศษ', 'Special Leave', true, 3, true, 10)
    ON CONFLICT (code) DO NOTHING;

    -- ลาโดยไม่รับค่าจ้าง (Unpaid Leave)
    INSERT INTO hr_leave_types (company_id, code, name_th, name_en, paid, probational_allowed, sort_order)
    VALUES (v_company_id, 'unpaid', 'ลาโดยไม่รับค่าจ้าง', 'Unpaid Leave', false, true, 11)
    ON CONFLICT (code) DO NOTHING;

    -- ลาตรวจสุขภาพ (Health Checkup Leave)
    INSERT INTO hr_leave_types (company_id, code, name_th, name_en, paid, annual_quota_days, probational_allowed, sort_order)
    VALUES (v_company_id, 'health_check', 'ลาตรวจสุขภาพ', 'Health Checkup Leave', true, 1, true, 12)
    ON CONFLICT (code) DO NOTHING;

    -- ลาอุปสมบท (Ordination Leave) - Unpaid
    INSERT INTO hr_leave_types (company_id, code, name_th, name_en, paid, annual_quota_days, probational_allowed, sort_order)
    VALUES (v_company_id, 'ordination', 'ลาอุปสมบท', 'Ordination Leave', false, 30, false, 13)
    ON CONFLICT (code) DO NOTHING;

    -- Seed 13 Thai public holidays for 2026
    INSERT INTO hr_holidays (company_id, holiday_date, name_th, name_en)
    VALUES
      (v_company_id, '2026-01-01', 'วันขึ้นปีใหม่', 'New Year''s Day'),
      (v_company_id, '2026-02-10', 'วันตรุษจีน', 'Chinese New Year'),
      (v_company_id, '2026-04-06', 'วันจักรี', 'Chakri Memorial Day'),
      (v_company_id, '2026-04-13', 'วันสงกรานต์', 'Songkran Festival Day 1'),
      (v_company_id, '2026-04-14', 'วันสงกรานต์', 'Songkran Festival Day 2'),
      (v_company_id, '2026-04-15', 'วันสงกรานต์', 'Songkran Festival Day 3'),
      (v_company_id, '2026-05-01', 'วันแรงงานแห่งชาติ', 'National Labour Day'),
      (v_company_id, '2026-05-05', 'วันฉัตรมงคล', 'Coronation Day'),
      (v_company_id, '2026-07-28', 'วันเฉลิมพระชนมพรรษา ร.10', 'HM the King''s Birthday'),
      (v_company_id, '2026-08-12', 'วันแม่แห่งชาติ', 'HM the Queen''s Birthday'),
      (v_company_id, '2026-10-23', 'วันปิยมหาราช', 'King Chulalongkorn Day'),
      (v_company_id, '2026-12-05', 'วันชาติและวันพ่อแห่งชาติ', 'National Day'),
      (v_company_id, '2026-12-10', 'วันรัฐธรรมนูญ', 'Constitution Day')
    ON CONFLICT (company_id, holiday_date) DO NOTHING;
  END IF;
END $$;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION hr_leave_types_holidays_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hr_leave_types_updated_at ON hr_leave_types;
CREATE TRIGGER hr_leave_types_updated_at BEFORE UPDATE ON hr_leave_types
  FOR EACH ROW EXECUTE FUNCTION hr_leave_types_holidays_updated_at();

DROP TRIGGER IF EXISTS hr_holidays_updated_at ON hr_holidays;
CREATE TRIGGER hr_holidays_updated_at BEFORE UPDATE ON hr_holidays
  FOR EACH ROW EXECUTE FUNCTION hr_leave_types_holidays_updated_at();
