-- P1.5: public avatars bucket for employee profile photos. Read = public (avatars render in
-- headers/chat/lists via plain <img>); write = service-role only (the HR avatar route validates
-- type/size and audits) — no authenticated storage policies on purpose.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
