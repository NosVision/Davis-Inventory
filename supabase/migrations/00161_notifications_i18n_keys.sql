-- 00161 — localize notifications at render time (per the viewer's locale) instead of freezing the
-- language at send time. Adds an OPTIONAL i18n key + params alongside the existing literal
-- title/body. The render surfaces prefer the key (translated in the viewer's locale) and fall back
-- to the literal when no key is present — so every existing row (title_key IS NULL) renders exactly
-- as before, and push/LINE payloads keep using the literal string (they render in the OS tray /
-- LINE app, outside the app's i18n layer, so they can't be localized after send).

alter table public.notifications
  add column if not exists title_key text,
  add column if not exists body_key text,
  add column if not exists params jsonb;

comment on column public.notifications.title_key is
  'Optional next-intl message key for the title, translated in the viewer''s locale at render time. Null => use the literal title.';
comment on column public.notifications.body_key is
  'Optional next-intl message key for the body. Null => use the literal body.';
comment on column public.notifications.params is
  'ICU interpolation values for title_key/body_key (e.g. {"store":"...","month":"..."}).';
