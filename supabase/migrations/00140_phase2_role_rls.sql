-- 00140_phase2_role_rls.sql
-- Phase 2 of the reworked role model (owner ask 2026-07-08): enforce, at the DB layer, the
-- reduced CROSS-STORE access of accountant + hr.
--
-- Context: nearly all operational tables gate access by store membership —
--   (store_id IN get_user_store_ids()) OR is_admin()
-- so a user's data access follows the stores they're assigned to (user_stores), regardless of role.
-- The one broad ROLE lever is is_admin() (was owner/accountant/hq/hr = cross-store super-access).
-- New model: only owner (all) + hq (approvals/inventory/deposit) keep cross-store super-access;
-- accountant → commission only; hr → HR only (HR access comes from can_manage_hr(), not is_admin()).

-- 1) Preserve/grant AE (commission) for accountant + cashier BEFORE tightening is_admin(), so they
--    keep commission cross-store even without a store assignment. (delete stays is_admin = owner/hq.)
alter policy commission_entries_select on public.commission_entries
  using ((store_id in (select public.get_user_store_ids())) or public.is_admin()
         or public.get_user_role() = any (array['accountant','cashier']::public.user_role[]));
alter policy commission_entries_insert on public.commission_entries
  with check ((store_id in (select public.get_user_store_ids())) or public.is_admin()
         or public.get_user_role() = any (array['accountant','cashier']::public.user_role[]));
alter policy commission_entries_update on public.commission_entries
  using ((store_id in (select public.get_user_store_ids())) or public.is_admin()
         or public.get_user_role() = any (array['accountant','cashier']::public.user_role[]))
  with check ((store_id in (select public.get_user_store_ids())) or public.is_admin()
         or public.get_user_role() = any (array['accountant','cashier']::public.user_role[]));
alter policy commission_payments_select on public.commission_payments
  using ((store_id in (select public.get_user_store_ids())) or public.is_admin()
         or public.get_user_role() = any (array['accountant','cashier']::public.user_role[]));
alter policy commission_payments_insert on public.commission_payments
  with check ((store_id in (select public.get_user_store_ids())) or public.is_admin()
         or public.get_user_role() = any (array['accountant','cashier']::public.user_role[]));
alter policy commission_payments_update on public.commission_payments
  using ((store_id in (select public.get_user_store_ids())) or public.is_admin()
         or public.get_user_role() = any (array['accountant','cashier']::public.user_role[]))
  with check ((store_id in (select public.get_user_store_ids())) or public.is_admin()
         or public.get_user_role() = any (array['accountant','cashier']::public.user_role[]));

-- 2) Tighten the cross-store super-access lever.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role in ('owner', 'hq')
  );
$$;

-- NOTE (remaining, deliberately NOT changed here — needs per-subsystem review + testing):
-- some POS/inventory write policies still list manager/accountant as pure role checks
-- (e.g. inv_products_write, pos_recipes_write, pos_settings_write, menu_items_write). Per the new
-- matrix accountant should lose these and manager should be limited to deposit; but those tables
-- belong to the POS/purchasing subsystems whose menu exposure needs tracing before tightening, so
-- they are left as-is for now (still hidden from the menu in phase 1).
