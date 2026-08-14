-- 00188_annual_holidays_2026.sql
-- Applied to production 2026-08-14.
--
-- The company's own 2026 holiday announcement, signed by the MD and addressed to all four venues
-- (Baccarat, 24 Blvd, Upper House, House of Savoy). hr_holidays held nothing but HR Test Co's
-- fixture rows until now, so leave and payroll were running as if the year had no holidays at all.
--
-- What a row here actually does:
--   • a leave request spanning the date does not spend quota on it (countLeaveDays)
--   • payroll drops it from the days someone was expected to work, so absence is not docked
--   • the roster, timesheet and ESS screens mark it
--
-- Per company, because that is the only axis hr_holidays has. All four operating companies get
-- the same 13 days, matching the announcement (owner decision 2026-08-14). HR Test Co keeps its
-- own fixture list untouched.
--
-- NOT the generic Thai public-holiday list: this is the company's, and it differs. It leaves out
-- วันจักรี, วันฉัตรมงคล, วันปิยมหาราช, วันรัฐธรรมนูญ, ตรุษจีน and the third Songkran day, and it
-- adds two the state does not observe — ชดเชยวันสิ้นปี (2 Jan) and วันสิ้นปี (31 Dec). Do not
-- "correct" it against a public calendar.
--
-- Every weekday was checked against the 2026 calendar and matches the announcement.
-- Idempotent: re-running inserts nothing, guarded on (company_id, holiday_date).

insert into public.hr_holidays (company_id, holiday_date, name_th, name_en, is_public_holiday, active)
select c.id, h.d, h.th, h.en, true, true
from public.hr_companies c
cross join (values
  ('2026-01-01'::date, 'วันขึ้นปีใหม่',                              'New Year''s Day'),
  ('2026-01-02'::date, 'ชดเชยวันสิ้นปี',                             'Substitution for New Year''s Eve'),
  ('2026-03-03'::date, 'วันมาฆบูชา',                                 'Makha Bucha Day'),
  ('2026-04-13'::date, 'วันสงกรานต์',                                'Songkran Festival'),
  ('2026-04-14'::date, 'วันสงกรานต์',                                'Songkran Festival'),
  ('2026-05-01'::date, 'วันแรงงานแห่งชาติ',                          'National Labour Day'),
  ('2026-05-31'::date, 'วันวิสาขบูชา',                               'Visakha Bucha Day'),
  ('2026-06-03'::date, 'วันเฉลิมพระชนมพรรษาฯ พระบรมราชินี',           'H.M. The Queen''s Birthday'),
  ('2026-07-29'::date, 'วันอาสาฬหบูชา',                              'Asarnha Bucha Day'),
  ('2026-08-12'::date, 'วันเฉลิมพระชนมพรรษาฯ พระนางเจ้าสิริกิติ์',    'Queen Sirikit The Queen Mother''s Birthday'),
  ('2026-10-13'::date, 'วันคล้ายวันสวรรคต ร.9',                      'King Rama IX Memorial Day'),
  ('2026-12-05'::date, 'วันคล้ายวันพระบรมราชสมภพ ร.9',               'King Bhumibol Adulyadej''s Birthday'),
  ('2026-12-31'::date, 'วันสิ้นปี',                                   'New Year''s Eve')
) as h(d, th, en)
where c.name <> 'HR Test Co'
  and not exists (
    select 1 from public.hr_holidays x
    where x.company_id = c.id and x.holiday_date = h.d
  );
