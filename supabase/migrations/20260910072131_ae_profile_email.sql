-- Optional contact email for AE profiles, including fresh installations.
alter table public.ae_profiles add column if not exists email text;
