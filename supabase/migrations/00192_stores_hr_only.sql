-- Mark a store as existing for HR only, so the operational side of the app never offers it.
--
-- The OFFICE store was added so office staff have somewhere to be rostered and to clock in
-- (00191). It is not a trading venue: it holds no stock, takes no orders and has no till, so
-- listing it in the venue switcher and the stock/POS pickers is pure noise — and worse, an
-- invitation to file a count or an order against a place that cannot have one.
--
-- The app shell reads this flag when it builds a user's venue list, so someone whose only venue is
-- the office sees what a user with no venue sees: the basic menu, no venue switcher, no venue-scoped
-- data. HR's own pages keep listing it — attendance, rostering and the timesheet are exactly what
-- it exists for (owner ask 2026-08-18).
alter table stores add column if not exists hr_only boolean not null default false;

comment on column stores.hr_only is
  'Venue exists for HR (attendance/roster) only — hidden from the app shell venue list and every operational picker.';

update stores set hr_only = true where store_code = 'OFFICE';
