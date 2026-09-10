-- Per-branch policy for attendance recorded beyond the standard geofence.
alter table public.hr_locations
  add column if not exists allow_outside_geofence boolean not null default false,
  add column if not exists outside_max_distance_m integer not null default 150;

-- Make the existing-row migration explicit, including any pre-existing nullable values.
update public.hr_locations
set
  allow_outside_geofence = false,
  outside_max_distance_m = 150;

alter table public.hr_locations
  add constraint hr_locations_radius_m_positive_check check (radius_m > 0),
  add constraint hr_locations_outside_max_distance_m_positive_check check (outside_max_distance_m > 0),
  add constraint hr_locations_outside_attendance_distance_check
    check (not allow_outside_geofence or outside_max_distance_m >= radius_m);
