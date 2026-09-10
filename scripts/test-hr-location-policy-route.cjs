const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');
const { NextResponse } = require('next/server');

function loadRoute({ stores = [{ id: 'branch-a', store_name: 'Branch A', store_code: 'A' }], locations = [], scope, auth }) {
  const writes = [];
  const audits = [];

  const service = {
    from(table) {
      let upserted = null;
      const resultFor = () => {
        if (table === 'stores') return { data: stores, error: null };
        if (table === 'hr_locations') return { data: upserted ?? locations, error: null };
        throw new Error(`Unexpected table: ${table}`);
      };
      const query = {
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        order() { return query; },
        upsert(payload, options) {
          writes.push({ payload, options });
          upserted = payload;
          return query;
        },
        single() { return Promise.resolve(resultFor()); },
        then(resolve, reject) { return Promise.resolve(resultFor()).then(resolve, reject); },
      };
      return query;
    },
  };

  const file = path.resolve('src/app/api/hr/locations/route.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (name) => {
    const imports = {
      'next/server': { NextResponse },
      '@/lib/supabase/server': { createServiceClient: () => service },
      '@/lib/hr/route-auth': {
        resolveHrScope: async () => scope ?? { ok: true, userId: 'hr-user', storeIds: null },
        requireStoreManager: async () => auth ?? { ok: true, userId: 'hr-user', role: 'owner', fullHr: true },
      },
      '@/lib/hr/audit': { logHrAudit: async (_service, event) => audits.push(event) },
    };
    if (name in imports) return imports[name];
    throw new Error(`Unexpected dependency: ${name}`);
  });

  return { ...mod.exports, writes, audits };
}

const requestFor = (body) => ({ json: async () => body });

test('GET defaults an absent branch policy to disabled and 150 m', async () => {
  const { GET } = loadRoute({ locations: [] });

  const response = await GET();
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(json.data, [{
    store_id: 'branch-a', store_name: 'Branch A', store_code: 'A',
    lat: null, lng: null, radius_m: null,
    allow_outside_geofence: false, outside_max_distance_m: 150,
  }]);
});

test('PUT rejects a non-boolean outside attendance switch', async () => {
  const route = loadRoute({});

  const response = await route.PUT(requestFor({
    store_id: 'branch-a', lat: 13.7, lng: 100.5, radius_m: 150,
    allow_outside_geofence: 'true', outside_max_distance_m: 300,
  }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'allow_outside_geofence must be a boolean');
  assert.equal(route.writes.length, 0);
});

for (const outsideMaxDistanceM of [0, -1, 150.5, '300']) {
  test(`PUT rejects invalid outside maximum distance: ${JSON.stringify(outsideMaxDistanceM)}`, async () => {
    const route = loadRoute({});

    const response = await route.PUT(requestFor({
      store_id: 'branch-a', lat: 13.7, lng: 100.5, radius_m: 150,
      allow_outside_geofence: true, outside_max_distance_m: outsideMaxDistanceM,
    }));

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'outside_max_distance_m must be a positive integer');
    assert.equal(route.writes.length, 0);
  });
}

test('PUT rejects an enabled outside maximum below the branch radius', async () => {
  const route = loadRoute({});

  const response = await route.PUT(requestFor({
    store_id: 'branch-a', lat: 13.7, lng: 100.5, radius_m: 150,
    allow_outside_geofence: true, outside_max_distance_m: 149,
  }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'outside_max_distance_m must be at least radius_m when outside attendance is enabled');
  assert.equal(route.writes.length, 0);
});

test('PUT persists a valid branch outside attendance policy and audits the saved row', async () => {
  const route = loadRoute({});

  const response = await route.PUT(requestFor({
    store_id: 'branch-a', lat: 13.7, lng: 100.5, radius_m: 150,
    allow_outside_geofence: true, outside_max_distance_m: 300,
  }));
  const json = await response.json();

  const expected = {
    store_id: 'branch-a', lat: 13.7, lng: 100.5, radius_m: 150, updated_by: 'hr-user',
    allow_outside_geofence: true, outside_max_distance_m: 300,
  };
  assert.equal(response.status, 200);
  assert.deepEqual(json.data, expected);
  assert.deepEqual(route.writes, [{ payload: expected, options: { onConflict: 'store_id' } }]);
  assert.deepEqual(route.audits, [{
    actorId: 'hr-user', action: 'update', table: 'hr_locations', recordId: 'branch-a', after: expected,
  }]);
});

test('PUT makes no database write when the store authorization fails', async () => {
  const route = loadRoute({ auth: { ok: false, error: 'Forbidden', status: 403 } });

  const response = await route.PUT(requestFor({
    store_id: 'branch-a', lat: 13.7, lng: 100.5, radius_m: 150,
    allow_outside_geofence: true, outside_max_distance_m: 300,
  }));

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'Forbidden');
  assert.equal(route.writes.length, 0);
  assert.equal(route.audits.length, 0);
});
