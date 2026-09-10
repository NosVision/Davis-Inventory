-- Expand the deposit audit page from HQ-only to Owner + HQ. Recreate the
-- view instead of editing the previously shipped migration so databases that
-- already applied it receive the permission change safely.
CREATE OR REPLACE VIEW public.hq_deposit_audit_history
WITH (security_invoker = true)
AS
SELECT
  audit.id,
  COALESCE(audit.store_id, deposit.store_id) AS store_id,
  audit.action_type,
  audit.table_name,
  audit.record_id,
  audit.old_value,
  audit.new_value,
  audit.changed_by,
  audit.created_at,
  COALESCE(NULLIF(profile.display_name, ''), profile.username, 'ระบบ') AS actor_name,
  profile.username AS actor_username,
  profile.role AS actor_role,
  store.store_name,
  store.store_code,
  COALESCE(
    audit.new_value ->> 'deposit_code',
    audit.old_value ->> 'deposit_code',
    deposit.deposit_code
  ) AS deposit_code,
  COALESCE(
    audit.new_value ->> 'customer_name',
    audit.old_value ->> 'customer_name',
    deposit.customer_name
  ) AS customer_name,
  COALESCE(
    audit.new_value ->> 'product_name',
    audit.old_value ->> 'product_name',
    deposit.product_name
  ) AS product_name,
  LOWER(CONCAT_WS(' ',
    audit.action_type,
    audit.record_id,
    audit.old_value::text,
    audit.new_value::text,
    profile.display_name,
    profile.username,
    profile.role,
    store.store_name,
    store.store_code,
    deposit.deposit_code,
    deposit.customer_name,
    deposit.product_name
  )) AS search_text
FROM public.audit_logs AS audit
LEFT JOIN public.deposits AS deposit
  ON audit.table_name = 'deposits'
 AND deposit.id::text = audit.record_id
LEFT JOIN public.profiles AS profile
  ON profile.id = audit.changed_by
LEFT JOIN public.stores AS store
  ON store.id = COALESCE(audit.store_id, deposit.store_id)
WHERE public.get_user_role() IN ('owner'::public.user_role, 'hq'::public.user_role)
AND audit.action_type = ANY (ARRAY[
  'DEPOSIT_CREATED',
  'DEPOSIT_REQUEST_APPROVED',
  'DEPOSIT_REQUEST_REJECTED',
  'DEPOSIT_STATUS_CHANGED',
  'DEPOSIT_BAR_CONFIRMED',
  'DEPOSIT_BAR_REJECTED',
  'DEPOSIT_UPDATED',
  'DEPOSIT_EXPIRY_EXTENDED',
  'DEPOSIT_VIP_CHANGED',
  'DEPOSIT_NO_DEPOSIT_CREATED',
  'WITHDRAWAL_REQUESTED',
  'WITHDRAWAL_COMPLETED',
  'WITHDRAWAL_REJECTED',
  'WITHDRAWAL_CANCELLED',
  'TRANSFER_CREATED',
  'TRANSFER_CONFIRMED',
  'TRANSFER_REJECTED',
  'CUSTOMER_DEPOSIT_REQUEST',
  'CUSTOMER_DEPOSIT_REQUEST_CANCELLED',
  'CUSTOMER_WITHDRAWAL_REQUEST',
  'CRON_DEPOSIT_EXPIRED',
  'VIP_DEPOSIT_EXPIRED'
]::text[]);

REVOKE ALL ON public.hq_deposit_audit_history FROM anon;
GRANT SELECT ON public.hq_deposit_audit_history TO authenticated;
