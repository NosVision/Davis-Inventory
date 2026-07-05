-- Self-service contact number (owner ask 2026-07-05: employees edit their own phone on
-- /me/profile). Lives on profiles (app-wide contact field, same as avatar_url) — writes go
-- through the ESS route (service role, own row only, audited), so no new RLS is needed.
alter table public.profiles add column phone text;
