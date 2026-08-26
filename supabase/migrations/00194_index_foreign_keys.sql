-- Every foreign key in `public` gets a covering index.
--
-- 188 of them had none. An unindexed FK costs twice. Reading, "which rows point at this one" is a
-- sequential scan — every join from a parent, every "what did this user create" lookup. Writing is
-- worse and less obvious: deleting or updating a PARENT row makes Postgres verify no child still
-- references it, and with no index that check scans the whole child table, once per constraint. A
-- single `delete from profiles` fans out into a scan of every table carrying a `created_by`. Right
-- now those tables are small enough to hide it; they are the ones that grow.
--
-- Catalog-driven rather than a hand-written list, deliberately. A list of 188 near-identical
-- statements is unreviewable and goes stale the day someone adds a table — this states the RULE,
-- proves itself complete against pg_catalog every time it runs, and is a no-op on the second run.
-- Deterministic too: the same schema always yields the same index names, so environments match.
--
-- What it deliberately does NOT touch:
--   * `_backup_*` tables — leftovers, not part of the schema
--   * FKs already covered, including by a PARTIAL index whose predicate is `(col IS NOT NULL)`:
--     an equality lookup implies that predicate, so the planner can already use it (7 of these)
--   * anything beyond FK columns. The hot query paths — hr_attendance(user_id, business_date),
--     hr_schedule(user_id, work_date), hr_payslips(payrun_id) — already have their composites,
--     and inventing more without a slow query to point at is guesswork.
--
-- Plain CREATE INDEX, not CONCURRENTLY: every table here is under 20k rows, so each build is
-- milliseconds, and staying inside the transaction means a failure leaves nothing half-applied.

do $$
declare
  r record;
  idx_name text;
  created int := 0;
begin
  for r in
    with fk as (
      select c.conrelid,
             t.relname as tbl,
             c.conkey::int[] as conkey,
             (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
                from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as collist,
             (select string_agg(a.attname, '_' order by k.ord)
                from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as colslug
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where c.contype = 'f'
        and n.nspname = 'public'
        and t.relname not like '\_backup%'
    ),
    cov as (
      select i.indrelid,
             (string_to_array(i.indkey::text, ' ')::int[]) as keys,
             i.indpred is null as full_idx,
             pg_get_expr(i.indpred, i.indrelid) as pred
      from pg_index i
    )
    select distinct fk.tbl, fk.collist, fk.colslug
    from fk
    where not exists (
      select 1 from cov
      where cov.indrelid = fk.conrelid
        -- the index's LEADING columns must be the FK's columns, in order
        and cov.keys[1:array_length(fk.conkey, 1)] = fk.conkey
        and (cov.full_idx or cov.pred = '(' || fk.collist || ' IS NOT NULL)')
    )
  loop
    -- Postgres truncates identifiers at 63 bytes, which would silently collide two long names
    -- into one. Fall back to a hash suffix rather than let that happen.
    idx_name := 'idx_' || r.tbl || '_' || r.colslug;
    if octet_length(idx_name) > 63 then
      idx_name := left('idx_' || r.tbl, 50) || '_' || substr(md5(r.colslug), 1, 8);
    end if;

    execute format('create index if not exists %I on public.%I (%s)', idx_name, r.tbl, r.collist);
    created := created + 1;
  end loop;

  raise notice 'foreign-key indexes ensured: %', created;
end $$;
