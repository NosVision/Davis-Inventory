-- 00086_hr_attendance.sql
-- P2.1: time & attendance (§F/§I). Per-store geofence (HR sets pin + radius) + attendance events
-- (in/out/break_start/break_end) with GPS, distance, in-geofence flag, watermarked selfie, and
-- anti-VPN/GPS-spoof fields (ip / ip_country / is_vpn_suspect) — flagged, not blocked (§F).

-- one geofence per store (HR-settable).
create table if not exists public.hr_locations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores(id) on delete cascade,
  lat double precision,
  lng double precision,
  radius_m int not null default 150,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create trigger hr_locations_set_updated_at before update on public.hr_locations
  for each row execute function public.hr_set_updated_at();

create table if not exists public.hr_attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  type text not null check (type in ('in','out','break_start','break_end')),
  ts timestamptz not null default now(),
  business_date date not null,               -- Bangkok 6am-cutoff business day (grouping)
  gps_lat double precision,
  gps_lng double precision,
  distance_m double precision,               -- metres from the store pin
  in_geofence boolean,
  photo_url text,                            -- watermarked selfie (public bucket)
  ip text,
  ip_country text,
  is_vpn_suspect boolean not null default false,
  device text,
  created_at timestamptz not null default now()
);
create index if not exists hr_attendance_user_date_idx on public.hr_attendance(user_id, business_date);
create index if not exists hr_attendance_store_date_idx on public.hr_attendance(store_id, business_date);
create index if not exists hr_attendance_suspect_idx on public.hr_attendance(is_vpn_suspect) where is_vpn_suspect = true;

alter table public.hr_locations enable row level security;
alter table public.hr_attendance enable row level security;

-- geofence: readable by any authenticated user (needed to check in); HR writes.
create policy hr_locations_select on public.hr_locations
  for select to authenticated using (true);
create policy hr_locations_write on public.hr_locations
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());

-- attendance: a user sees/creates their own rows; HR sees all. (Server inserts via service role
-- so ip/is_vpn_suspect can't be client-forged; the self-scoped insert policy is defense-in-depth.)
create policy hr_attendance_select on public.hr_attendance
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_hr());
create policy hr_attendance_insert on public.hr_attendance
  for insert to authenticated
  with check (user_id = (select auth.uid()));
