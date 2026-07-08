-- 00141_restore_admin_crossstore.sql
-- Correction to 00140: restore is_admin() cross-store super-access for accountant + hr.
--
-- accountant and hr are back-office roles that must see data across ALL stores to do their job
-- (accounting reconciliation, HR/payroll). Their reduced scope in the new role model is enforced at
-- the MENU layer (phase 1) — NOT at the data layer. So is_admin() goes back to owner/accountant/hq/hr.
--
-- The commission accountant/cashier clause added in 00140 is kept (harmless, and lets a cashier
-- reach AE/commission even without the is_admin shortcut).
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role in ('owner', 'accountant', 'hq', 'hr')
  );
$$;
