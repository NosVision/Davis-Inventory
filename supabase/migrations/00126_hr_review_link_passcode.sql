-- Review-link passcode (owner 2026-07-06): a short code the accountant must enter to open the
-- link — a second factor on top of the already-strong random token. Default '1234' (HR can
-- change it at mint). Low-sensitivity convenience code, stored plainly on the HR-only table so
-- HR can re-show it; the public review routes compare it but never return it.
alter table public.hr_payrun_review_links add column passcode text not null default '1234';
