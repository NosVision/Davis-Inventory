-- 00085_hr_assets_code_unique.sql
-- P1.4 review: asset_code is a physical lookup tag — enforce uniqueness (P1.4 review MEDIUM).
create unique index if not exists hr_assets_asset_code_uq
  on public.hr_assets (asset_code)
  where asset_code is not null;
