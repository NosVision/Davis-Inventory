const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

// Execute the real route and authorization helpers with an in-memory database boundary.
function setup(role = 'staff', canSchedule = true, signedIn = true, assignments = [], finalized = false) {
  const writes = [];
  function from(table) {
    const filters = {};
    let action = 'select';
    const q = {
      select() { return q; }, order() { return q; },
      eq(k, v) { filters[k] = v; return q; },
      is(k, v) { filters[k] = v; return q; },
      range() { return q; }, limit() { return q; },
      lte() { return q; }, gte() { return q; }, or() { return q; },
      insert() { action = 'insert'; return q; },
      update() { action = 'update'; return q; },
      delete() { action = 'delete'; return q; },
      single() { return q; }, maybeSingle() { return q; },
      then(resolve, reject) {
        if (action !== 'select') writes.push({ table, action, filters });
        let data = [];
        if (table === 'profiles') data = { role };
        if (table === 'hr_manager_scopes') data = filters.store_id === 'own'
          ? { id: 'scope', can_schedule: canSchedule, can_approve: !canSchedule } : null;
        if (table === 'hr_shift_templates') data = filters.id
          ? { id: filters.id, store_id: filters.id === 'foreign' ? 'other' : filters.id === 'global' ? null : 'own' }
          : { id: 'new' };
        if (table === 'hr_schedule') data = assignments;
        if (table === 'hr_payruns') data = finalized ? [{ id: 'locked' }] : [];
        if (table === 'user_stores') data = [{ store_id: 'own' }];
        return Promise.resolve({ data, error: null, count: table === 'hr_schedule' ? assignments.length : 0 }).then(resolve, reject);
      },
    };
    return q;
  }
  const db = { from, auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'captain' } : null } }) } };
  const server = { createClient: async () => db, createServiceClient: () => db };
  function load(path, imports) {
    const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    vm.runInNewContext(code, { exports, console, require: (name) => {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    } }, { filename: path });
    return exports;
  }
  const access = load('src/lib/hr/access.ts', {});
  const auth = load('src/lib/hr/route-auth.ts', {
    '@/lib/supabase/server': server, '@/lib/hr/access': access,
  });
  const route = load('src/app/api/hr/shift-templates/route.ts', {
    '@/lib/supabase/server': server, '@/lib/hr/route-auth': auth,
    '@/lib/hr/period-lock': load('src/lib/hr/period-lock.ts', {}),
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
  });
  return { route, writes };
}

const cases = [
  ['list', 'GET', '?store_id=own', {}, 200],
  ['usage', 'GET', '?usage=own&store_id=other', {}, 200],
  ['create', 'POST', '', { store_id: 'own', label: 'Evening', start_time: '17:00', end_time: '01:00' }, 201],
  ['edit', 'PUT', '', { id: 'own', store_id: 'other', label: 'Updated' }, 200],
  ['delete', 'DELETE', '?id=own', {}, 200],
];
const request = (query, body) => ({ nextUrl: new URL(`https://test.local/api${query}`), json: async () => body });
for (const [name, method, query, body, status] of cases) {
  test(`captain can ${name} own store templates`, async () => {
    const { route } = setup();
    assert.equal((await route[method](request(query, body))).status, status);
  });
  test(`approval-only manager cannot ${name} templates`, async () => {
    const { route, writes } = setup('staff', false);
    assert.equal((await route[method](request(query, body))).status, 403);
    assert.equal(writes.length, 0);
  });
  test(`signed-out user cannot ${name} templates`, async () => {
    const { route, writes } = setup('staff', true, false);
    assert.equal((await route[method](request(query, body))).status, 401);
    assert.equal(writes.length, 0);
  });
  for (const role of ['owner', 'hr', 'hq']) test(`${role} can ${name} templates`, async () => {
    const { route } = setup(role);
    assert.equal((await route[method](request(query, body))).status, status);
  });
}
for (const [method, query, body] of [
  ['GET', '?store_id=other', {}], ['GET', '?usage=foreign&store_id=own', {}],
  ['POST', '', { store_id: 'other' }], ['POST', '', { store_id: 'own', company_id: 'company' }],
  ['GET', '?store_id=own&company_id=company', {}],
  ['PUT', '', { id: 'foreign', store_id: 'own', label: 'Changed' }],
  ['DELETE', '?id=foreign&store_id=own', {}],
  ['PUT', '', { id: 'global', store_id: 'own', label: 'Changed' }],
  ['GET', '?usage=global&store_id=own', {}],
]) test(`captain denied outside scope: ${method} ${query} ${JSON.stringify(body)}`, async () => {
  const { route, writes } = setup();
  assert.equal((await route[method](request(query, body))).status, 403);
  assert.equal(writes.length, 0);
});

for (const method of ['PUT', 'DELETE']) {
  for (const [store, finalized] of [['other', false], ['own', true]]) {
    test(`${method} cannot affect ${finalized ? 'finalized' : 'foreign'} assignments`, async () => {
      const { route, writes } = setup('staff', true, true,
        [{ user_id: 'employee', work_date: '2026-09-01', store_id: store }], finalized);
      const result = await route[method](request('?id=own', { id: 'own', start_time: '18:00' }));
      assert.equal(result.status, 409);
      assert.equal(writes.length, 0);
    });
  }
}
test('captain can delete used template in an open period', async () => {
  const { route, writes } = setup('staff', true, true,
    [{ user_id: 'employee', work_date: '2026-09-01', store_id: 'own' }]);
  assert.equal((await route.DELETE(request('?id=own', {}))).status, 200);
  assert.ok(writes.some(x => x.table === 'hr_schedule' && x.action === 'delete'));
});
