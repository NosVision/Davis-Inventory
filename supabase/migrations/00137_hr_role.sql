-- New 'hr' role (owner ask 2026-07-08): a broad, cross-store role for HR staff who should reach
-- every page EXCEPT the deposit ("ฝากเหล้า") and stock-count ("นับสต๊อก") systems — those are hidden
-- in the app menu and blocked in middleware. At the data layer 'hr' is treated like the other admin
-- roles (owner/accountant/hq) so the pages it CAN see actually load, and it passes the HR gate.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'hr';

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner', 'accountant', 'hq', 'hr')
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_hr()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role in ('owner'::public.user_role, 'hr'::public.user_role)
  ) or exists (
    select 1 from public.user_permissions where user_id = auth.uid() and permission = 'can_manage_hr'
  );
$function$;
