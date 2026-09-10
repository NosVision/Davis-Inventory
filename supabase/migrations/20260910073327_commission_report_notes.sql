-- Allow a monthly remark without implying that the AE requested a certificate.
alter table public.commission_wht_certs
  drop constraint if exists commission_wht_certs_status_check;
alter table public.commission_wht_certs
  add constraint commission_wht_certs_status_check
  check (status in ('none', 'requested', 'issued'));
