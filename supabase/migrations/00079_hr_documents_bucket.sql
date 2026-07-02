-- 00079_hr_documents_bucket.sql
-- Private storage bucket for sensitive HR documents (ID copies, contracts, signatures) — PDPA (Addendum A P1.5).
-- Private (public=false): access only via server-minted signed URLs. Uploads/signing go through
-- /api/hr/documents which checks canManageHr and uses the service-role client (bypasses RLS).
-- Storage RLS below is defense-in-depth so a leaked anon/authenticated key still cannot touch these objects.

insert into storage.buckets (id, name, public)
values ('hr-documents', 'hr-documents', false)
on conflict (id) do nothing;

drop policy if exists "hr_documents_select" on storage.objects;
create policy "hr_documents_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'hr-documents' and public.can_manage_hr());

drop policy if exists "hr_documents_insert" on storage.objects;
create policy "hr_documents_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'hr-documents' and public.can_manage_hr());

drop policy if exists "hr_documents_update" on storage.objects;
create policy "hr_documents_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'hr-documents' and public.can_manage_hr());

drop policy if exists "hr_documents_delete" on storage.objects;
create policy "hr_documents_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'hr-documents' and public.can_manage_hr());
