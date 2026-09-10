/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node PostgreSQL contract probe. */
// Install @electric-sql/pglite in a temporary prefix and set ATTENDANCE_PROBE_PGLITE_MODULE
// to its absolute package directory. No live database, project credentials or persistent data are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { PGlite } = require(process.env.ATTENDANCE_PROBE_PGLITE_MODULE || '@electric-sql/pglite');

test('migration denies direct authenticated inserts and preserves service-role inserts and read access', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      begin;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select current_setting('request.jwt.claim.sub', true)::uuid $$;
      grant usage on schema public, auth to authenticated, service_role;
      create table public.hr_attendance (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        type text not null,
        business_date date not null,
        in_geofence boolean,
        review_status text
      );
      alter table public.hr_attendance enable row level security;
      grant select, insert, update, delete on public.hr_attendance to authenticated, service_role;
      create policy hr_attendance_select on public.hr_attendance for select to authenticated
        using (user_id = (select auth.uid()));
      create policy hr_attendance_insert on public.hr_attendance for insert to authenticated
        with check (user_id = (select auth.uid()));
      select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
      set local role authenticated;
      insert into public.hr_attendance (user_id, type, business_date, in_geofence)
        values (auth.uid(), 'in', current_date, true);
      reset role;
    `);
    const before = await db.query('select count(*)::int as count from public.hr_attendance');
    assert.equal(before.rows[0].count, 1, 'The original self-insert policy permits the bypass');

    const migration = fs.readFileSync(path.resolve(__dirname,
      '../supabase/migrations/20260910174248_deny_direct_attendance_insert.sql'), 'utf8');
    await db.exec(migration);
    await db.exec('savepoint denied_insert; set local role authenticated;');
    let insertError;
    try {
      await db.exec(`insert into public.hr_attendance (user_id, type, business_date, in_geofence)
        values (auth.uid(), 'out', current_date, true)`);
    } catch (error) {
      insertError = error;
    }
    await db.exec('rollback to savepoint denied_insert;');
    assert.equal(insertError?.code, '42501', 'Direct authenticated insert must fail with insufficient privilege');

    const access = await db.query(`select
      has_table_privilege('authenticated', 'public.hr_attendance', 'INSERT') as client_insert,
      has_table_privilege('authenticated', 'public.hr_attendance', 'SELECT') as client_select,
      has_table_privilege('authenticated', 'public.hr_attendance', 'UPDATE') as client_update,
      has_table_privilege('authenticated', 'public.hr_attendance', 'DELETE') as client_delete,
      has_table_privilege('service_role', 'public.hr_attendance', 'INSERT') as server_insert,
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_attendance'
        and policyname = 'hr_attendance_insert') as self_insert_policy`);
    assert.deepEqual(access.rows[0], {
      client_insert: false, client_select: true, client_update: true,
      client_delete: true, server_insert: true, self_insert_policy: false,
    });
    await db.exec(`set local role service_role;
      insert into public.hr_attendance (user_id, type, business_date, in_geofence, review_status)
        values ('00000000-0000-4000-8000-000000000001', 'out', current_date, false, 'pending');
      reset role;
      set local role authenticated;`);
    const readable = await db.query('select type, review_status from public.hr_attendance order by type');
    assert.deepEqual(readable.rows, [
      { type: 'in', review_status: null }, { type: 'out', review_status: 'pending' },
    ]);
    await db.exec('reset role; rollback;');
  } finally {
    await db.close();
  }
});
