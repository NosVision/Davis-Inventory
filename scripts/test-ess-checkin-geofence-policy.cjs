/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');
const { NextResponse } = require('next/server');

function loadSource(file, imports = {}, bindings = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.resolve(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', ...Object.keys(bindings), code)(
    mod, mod.exports, (name) => {
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    }, ...Object.values(bindings),
  );
  return mod.exports;
}

// Keep geospatial calculations, policy decisions and POST real; replace only external services.
const geo = loadSource('src/lib/hr/geo.ts');
const policy = loadSource('src/lib/hr/attendance-geofence-policy.ts');
const date = loadSource('src/lib/utils/date.ts');
const branch = (overrides = {}) => ({
  store_id: 'branch-a', lat: 0, lng: 0, radius_m: 150,
  allow_outside_geofence: false, outside_max_distance_m: 300, ...overrides,
});
const requestFor = (overrides = {}) => ({
  headers: new Headers({ 'x-real-ip': '203.0.113.1' }),
  json: async () => ({
    type: 'in', gps_lat: 0, gps_lng: 0.002,
    photo: 'data:image/jpeg;base64,/9j/', ...overrides,
  }),
});

function setup(options = {}) {
  const effects = { uploads: [], removed: [], attendance: [], hr: [], employee: [], ip: 0, openDays: 0, flags: 0 };
  const locations = options.locations ?? [branch()];
  const service = {
    from(table) {
      let columns;
      let inserted;
      let membership;
      const result = () => {
        if (table === 'user_stores') return { data: (options.storeIds ?? ['branch-a']).map(store_id => ({ store_id })), error: null };
        if (table === 'hr_locations') {
          // Project the requested columns: omitting policy columns must not silently pass tests.
          const data = locations.filter(row => membership.includes(row.store_id)).map(row =>
            Object.fromEntries(columns.split(',').map(key => key.trim()).map(key => [key, row[key]])));
          return { data, error: null };
        }
        if (table === 'hr_attendance') {
          if (inserted) return { data: options.insertError ? null : { id: 'punch-1' }, error: options.insertError ?? null };
          return { data: options.recent ?? [], error: null };
        }
        if (table === 'hr_schedule') return { data: options.roster === undefined ? { is_day_off: false } : options.roster, error: null };
        if (table === 'profiles') return { data: { display_name: 'พนักงานทดสอบ', username: 'employee' }, error: null };
        throw new Error(`Unexpected table: ${table}`);
      };
      const query = {
        select(value) { columns = value; return query; },
        eq() { return query; }, gte() { return query; }, not() { return query; },
        in(_column, values) { membership = values; return query; },
        insert(value) { inserted = value; effects.attendance.push(value); return query; },
        maybeSingle() { return query; }, single() { return query; },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return query;
    },
    storage: { from: () => ({
      upload: async (...args) => { effects.uploads.push(args); return { error: null }; },
      remove: async (paths) => { effects.removed.push(...paths); return { error: null }; },
    }) },
  };
  const route = loadSource('src/app/api/hr/ess/checkin/route.ts', {
    'next/server': { NextResponse },
    '@/lib/supabase/server': {
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: options.signedOut ? null : { id: 'employee' } } }) } }),
      createServiceClient: () => service,
    },
    '@/lib/hr/geo': geo,
    '@/lib/hr/attendance-geofence-policy': policy,
    '@/lib/utils/date': date,
    '@/lib/hr/request-ip': loadSource('src/lib/hr/request-ip.ts'),
    '@/lib/hr/ip-geo': { assessIp: async () => {
      effects.ip++;
      return { isMobile: true, lat: null, lng: null, is_vpn_suspect: options.vpn ?? false, country: 'TH' };
    } },
    '@/lib/hr/policy': { getHrPolicies: async () => ({ attendance_requires_roster: options.requiresRoster ?? false }) },
    '@/lib/hr/open-attendance': {
      findBlockingOpenDays: async () => { effects.openDays++; return options.blocking ?? []; },
      findUnclosedDays: async () => { effects.openDays++; return []; },
      flagUnclosedDays: async () => { effects.flags++; return 0; },
    },
    '@/lib/hr/notify': { notifyHrManagers: async (_service, payload) => { effects.hr.push(payload); } },
    '@/lib/notifications/service': { notifyUser: async payload => { effects.employee.push(payload); } },
  });
  return { ...route, effects };
}

function assertNoPunchWork(effects) {
  assert.deepEqual(effects, { uploads: [], removed: [], attendance: [], hr: [], employee: [], ip: 0, openDays: 0, flags: 0 });
}

for (const [name, location, lng, code, distance, allowed] of [
  ['strict branch outside radius', branch(), 0.002, 'outside_geofence_not_allowed', 222, 150],
  ['enabled branch beyond outer limit', branch({ allow_outside_geofence: true }), 0.004, 'outside_geofence_limit_exceeded', 445, 300],
  ['fraction beyond strict radius before rounding', branch(), 0.00135, 'outside_geofence_not_allowed', 150, 150],
  ['fraction beyond outer limit before rounding', branch({ allow_outside_geofence: true }), 0.0027, 'outside_geofence_limit_exceeded', 300, 300],
]) {
  test(`POST rejects ${name} before any upload, IP assessment or HR work`, async () => {
    const route = setup({ locations: [location] });
    const response = await route.POST(requestFor({ gps_lng: lng }));
    const json = await response.json();
    assert.equal(response.status, 403);
    assert.equal(json.code, code);
    assert.equal(json.distance_m, distance);
    assert.equal(json.allowed_distance_m, allowed);
    assert.match(json.error, /พื้นที่|ระยะ/);
    assertNoPunchWork(route.effects);
  });
}

test('POST accepts permitted outside attendance as pending with measured/allowed HR details', async () => {
  const route = setup({ locations: [branch({ allow_outside_geofence: true })] });
  const response = await route.POST(requestFor());
  const json = await response.json();
  assert.equal(response.status, 201);
  assert.equal(json.review_status, 'pending');
  assert.equal(json.in_geofence, false);
  assert.equal(json.distance_m, 222);
  assert.equal(route.effects.attendance[0].review_status, 'pending');
  assert.equal(route.effects.attendance[0].store_id, 'branch-a');
  assert.equal(route.effects.uploads.length, 1);
  assert.equal(route.effects.hr.length, 1);
  assert.deepEqual(route.effects.hr[0].data, {
    attendance_id: 'punch-1', store_id: 'branch-a', distance_m: 222,
    allowed_distance_m: 300, url: '/hr/attendance?review=pending',
  });
  assert.match(route.effects.hr[0].body, /222.*300/);
  assert.equal(route.effects.hr[0].storeId, 'branch-a');
  assert.equal(route.effects.employee[0].type, 'hr_attendance_result');
  assert.match(route.effects.employee[0].body, /บันทึกแล้ว/);
});

test('POST includes outside distances in HR notification even when VPN is also suspected', async () => {
  const route = setup({ locations: [branch({ allow_outside_geofence: true })], vpn: true });
  const response = await route.POST(requestFor());
  assert.equal(response.status, 201);
  assert.match(route.effects.hr[0].body, /น่าสงสัย/);
  assert.match(route.effects.hr[0].body, /222.*300/);
});

test('POST accepts inside attendance without review on a strict branch', async () => {
  const route = setup();
  const response = await route.POST(requestFor({ gps_lng: 0.001 }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).review_status, null);
  assert.equal(route.effects.attendance[0].in_geofence, true);
  assert.equal(route.effects.hr.length, 0);
});

test('POST chooses a containing branch over a nearer strict branch', async () => {
  const route = setup({ storeIds: ['branch-a', 'branch-b'], locations: [
    branch({ radius_m: 100 }),
    branch({ store_id: 'branch-b', lng: 0.004, radius_m: 400 }),
  ] });
  const response = await route.POST(requestFor({ gps_lng: 0.001 }));
  const json = await response.json();
  assert.equal(response.status, 201);
  assert.equal(json.store_id, 'branch-b');
  assert.equal(json.in_geofence, true);
  assert.equal(json.review_status, null);
});

test('POST cannot use a farther permissive branch or submitted policy to bypass the nearest strict branch', async () => {
  const route = setup({ storeIds: ['branch-a', 'branch-b'], locations: [
    branch(), branch({ store_id: 'branch-b', lng: 0.006, allow_outside_geofence: true, outside_max_distance_m: 1000 }),
  ] });
  const response = await route.POST(requestFor({ store_id: 'branch-b', allow_outside_geofence: true, outside_max_distance_m: 99999 }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'outside_geofence_not_allowed');
  assertNoPunchWork(route.effects);
});

test('POST keeps no-GPS attendance pending and attributed to the single assignment', async () => {
  const route = setup();
  const response = await route.POST(requestFor({ gps_lat: undefined, gps_lng: undefined }));
  const json = await response.json();
  assert.equal(response.status, 201);
  assert.equal(json.review_status, 'pending');
  assert.equal(json.in_geofence, null);
  assert.equal(json.store_id, 'branch-a');
});

test('POST keeps attendance without a configured geofence undeterminable', async () => {
  const route = setup({ locations: [] });
  const response = await route.POST(requestFor());
  const json = await response.json();
  assert.equal(response.status, 201);
  assert.equal(json.in_geofence, null);
  assert.equal(json.review_status, null);
});

for (const [name, options, expectedStatus] of [
  ['authentication', { signedOut: true }, 401],
  ['duplicate', { recent: [{ type: 'in', ts: new Date().toISOString() }] }, 409],
  ['day off', { roster: { is_day_off: true } }, 409],
  ['required roster', { roster: null, requiresRoster: true }, 409],
  ['unclosed day', { blocking: [{ business_date: '2026-09-01', in_ts: '2026-09-01T03:00:00Z' }] }, 409],
]) {
  test(`POST preserves the ${name} gate for permitted outside attendance`, async () => {
    const route = setup({ ...options, locations: [branch({ allow_outside_geofence: true })] });
    const response = await route.POST(requestFor());
    assert.equal(response.status, expectedStatus);
    assert.equal(route.effects.attendance.length, 0);
    assert.equal(route.effects.hr.length, 0);
  });
}

test('POST still removes an uploaded photo after an attendance insert failure', async () => {
  const route = setup({ locations: [branch({ allow_outside_geofence: true })], insertError: { message: 'insert failed' } });
  const response = await route.POST(requestFor());
  assert.equal(response.status, 500);
  assert.deepEqual(route.effects.removed, [route.effects.uploads[0][0]]);
  assert.equal(route.effects.hr.length, 0);
});

// Execute the actual submit callback, isolated from camera/rendering concerns via the TS AST.
// This catches lost error-code mapping and accidental success refresh after a rejected punch.
async function submitError(error, locale = 'th') {
  const source = ts.createSourceFile('page.tsx', fs.readFileSync(path.resolve('src/app/(dashboard)/me/checkin/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'doSubmit') callback = node.initializer.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback, 'The real check-in submit callback exists');
  const notifications = [];
  let refreshes = 0;
  const bindings = {
    photo: 'selfie', coords: { lat: 0, lng: 0.002 }, type: 'in',
    setSubmitting() {}, setPhoto() {}, fileInputRef: { current: null },
    fetch: async () => ({ ok: false, json: async () => error }),
    fetchToday: async () => { refreshes++; }, fetchOpenDays() {},
    t: key => key, tx: (th, en) => locale === 'th' ? th : en,
    toast: payload => notifications.push(payload),
  };
  const code = ts.transpileModule(`return (${callback});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const submit = new Function(...Object.keys(bindings), code)(...Object.values(bindings));
  await submit();
  assert.equal(refreshes, 0);
  assert.equal(notifications[0].type, 'error');
  return notifications[0].title;
}

test('employee submit maps strict rejection to a clear localized message', async () => {
  const message = await submitError({ code: 'outside_geofence_not_allowed', error: 'generic API error' });
  assert.match(message, /สาขา.*ไม่อนุญาต.*นอกพื้นที่/);
});

test('employee submit maps over-limit rejection with measured and allowed distance', async () => {
  const message = await submitError({ code: 'outside_geofence_limit_exceeded', error: 'generic API error', distance_m: 445, allowed_distance_m: 300 });
  assert.match(message, /445.*300/);
  assert.match(message, /ระยะ/);
});

test('employee submit localizes policy rejection in English', async () => {
  const message = await submitError({ code: 'outside_geofence_not_allowed', error: 'generic API error' }, 'en');
  assert.match(message, /branch.*not allow.*outside/i);
});

test('employee submit preserves unrelated API error fallback', async () => {
  assert.equal(await submitError({ error: 'วันนี้เป็นวันหยุดตามตารางงาน' }), 'วันนี้เป็นวันหยุดตามตารางงาน');
});
