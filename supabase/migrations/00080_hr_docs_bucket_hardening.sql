-- 00080_hr_docs_bucket_hardening.sql
-- Defense-in-depth for the private hr-documents bucket + fix a stale column comment (P1.1 review).

-- Storage enforces these even for service-role uploads, complementing the app-layer checks.
update storage.buckets
set file_size_limit = 10485760, -- 10MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
where id = 'hr-documents';

-- 00077 comment said [{ type, url, uploaded_at }] but the private bucket stores a PATH, not a public url.
comment on column public.hr_employees.documents is
  'jsonb array [{ type, path, name?, uploaded_at }] — path is a private hr-documents storage key; resolve to a short-lived signed URL via /api/hr/documents';
