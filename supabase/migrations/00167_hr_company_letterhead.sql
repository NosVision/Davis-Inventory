-- 00167: certificate letterhead fields — the legacy หนังสือรับรอง letterhead/footer prints the
-- company's English legal name and contact phone; hr_companies only had the Thai name + address.
alter table public.hr_companies
  add column if not exists name_en text,
  add column if not exists phone text;

comment on column public.hr_companies.name_en is 'English legal name — printed on certificate letterhead/footer';
comment on column public.hr_companies.phone is 'Contact phone — printed on certificate footer';
