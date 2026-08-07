-- 00179_ae_wht_cert_standing.sql
-- Owner ask 2026-08-07: some AEs ask for their ใบ 50 ทวิ every single month, and ticking the box
-- again on every monthly report is busywork. A standing flag on the AE means "this person always
-- asks" — the report then shows them as requested by default, and the monthly row in
-- commission_wht_certs is only needed to record that it was actually ISSUED.
alter table public.ae_profiles
  add column if not exists wht_cert_standing boolean not null default false;

comment on column public.ae_profiles.wht_cert_standing is
  'ขอใบ 50 ทวิ ประจำ — true means this AE requests a withholding-tax certificate every month, so the monthly report pre-marks them instead of HR ticking it each time.';
