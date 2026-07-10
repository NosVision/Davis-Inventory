-- Per-product variance measurement mode for the stock-count comparison.
-- Owner ask 2026-07-10: whole-bottle items (sealed champagne/premium spirits)
-- come in from POS as whole integers; losing 1 bottle is a small % on a
-- high count, so the old "within % OR within units" rule auto-approved it and
-- it never surfaced on the "needs explanation" page. Pour items come in with
-- decimals (fill level) and legitimately wobble by a small %.
--
-- variance_mode:
--   'auto'    (default) → detect from the numbers: both sides whole integers
--                         means bottle-counted → any >= 1 unit off must be
--                         explained; a decimal means pour-measured → % rule.
--   'unit'    → force bottle mode  (any >= 1 unit off needs explanation).
--   'percent' → force percent mode (legacy: small units OR small % is ok).
alter table public.products
  add column if not exists variance_mode text not null default 'auto';

alter table public.products
  drop constraint if exists products_variance_mode_check;

alter table public.products
  add constraint products_variance_mode_check
  check (variance_mode in ('auto', 'unit', 'percent'));

comment on column public.products.variance_mode is
  'Stock-count variance mode: auto (detect whole-bottle vs pour from the numbers), unit (bottle: >=1 off must be explained), percent (legacy % tolerance).';
