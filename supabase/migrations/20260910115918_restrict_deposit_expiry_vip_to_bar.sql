-- Only the Bar role may change an existing deposit's expiry date or VIP state.
-- Service-role jobs remain allowed so trusted cron/import maintenance is not blocked.
CREATE OR REPLACE FUNCTION public.enforce_deposit_expiry_vip_bar_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.expiry_date IS DISTINCT FROM OLD.expiry_date
     OR NEW.is_vip IS DISTINCT FROM OLD.is_vip THEN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND public.get_user_role() IS DISTINCT FROM 'bar'::public.user_role THEN
      RAISE EXCEPTION 'Only the Bar role may change deposit expiry or VIP status'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_deposit_expiry_vip_bar_only ON public.deposits;
CREATE TRIGGER trg_enforce_deposit_expiry_vip_bar_only
  BEFORE UPDATE OF expiry_date, is_vip ON public.deposits
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_deposit_expiry_vip_bar_only();
