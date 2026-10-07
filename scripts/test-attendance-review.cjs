/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const { test } = require('node:test');

function loadModule(rel) {
  const file = path.resolve(rel);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Date }, { filename: file });
  return exports;
}

const review = loadModule('src/lib/hr/attendance-review.ts');

/**
 * In-memory stand-in for the supabase-js query builder: just the calls the lib makes
 * (select / update + eq / in, awaited directly or after .select()).
 */
function fakeService(tables) {
  return {
    from(table) {
      const rows = tables[table];
      const filters = [];
      let patch = null;
      const matches = (r) => filters.every((f) => f(r));
      const run = () => {
        const hit = rows.filter(matches);
        if (patch) hit.forEach((r) => Object.assign(r, patch));
        return { data: hit.map((r) => ({ ...r })), error: null };
      };
      const builder = {
        select() { return builder; },
        update(p) { patch = p; return builder; },
        eq(col, v) { filters.push((r) => r[col] === v); return builder; },
        in(col, vs) { filters.push((r) => vs.includes(r[col])); return builder; },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return builder;
    },
  };
}

const punch = (over) => ({
  id: 'p1', user_id: 'u1', business_date: '2026-10-04', type: 'in',
  gps_lat: 13.7, in_geofence: true, is_vpn_suspect: false, review_status: 'pending', ...over,
});

test('own reasons read off the punch: no GPS, outside, VPN', () => {
  assert.deepEqual([...review.punchOwnReasons(punch({}))], []);
  assert.deepEqual(
    [...review.punchOwnReasons(punch({ gps_lat: null, in_geofence: false, is_vpn_suspect: true }))],
    ['no_gps', 'outside', 'vpn'],
  );
});

test('only a clean check-in can be handed to a request', () => {
  assert.equal(review.isOnlyUnclosedCandidate(punch({})), true);
  assert.equal(review.isOnlyUnclosedCandidate(punch({ type: 'out' })), false);
  assert.equal(review.isOnlyUnclosedCandidate(punch({ is_vpn_suspect: true })), false);
  assert.equal(review.isOnlyUnclosedCandidate(punch({ gps_lat: null })), false);
});

test('reviewReasonsFor adds "unclosed" only when the day has no check-out', async () => {
  const service = fakeService({
    hr_attendance: [
      punch({ id: 'open' }),
      punch({ id: 'closed', user_id: 'u2' }),
      punch({ id: 'closed-out', user_id: 'u2', type: 'out', review_status: null }),
    ],
  });
  const rows = [punch({ id: 'open' }), punch({ id: 'closed', user_id: 'u2', is_vpn_suspect: true })];
  const reasons = await review.reviewReasonsFor(service, rows);
  assert.deepEqual([...reasons.get('open')], ['unclosed']);
  assert.deepEqual([...reasons.get('closed')], ['vpn']);
});

test('a clean check-in with a pending missing-check-out request leaves the queue; a suspect one or another kind stays', async () => {
  const service = fakeService({
    hr_attendance_requests: [
      { user_id: 'u1', business_date: '2026-10-04', status: 'pending', kind: 'missing_out' },
      { user_id: 'u5', business_date: '2026-10-04', status: 'pending', kind: 'wrong_time' },
      { user_id: 'u3', business_date: '2026-10-04', status: 'pending', kind: 'missing_out' },
      { user_id: 'u4', business_date: '2026-10-04', status: 'approved', kind: 'missing_out' },
    ],
    hr_attendance: [
      punch({ id: 'handed-off' }),
      punch({ id: 'vpn-too', user_id: 'u3', is_vpn_suspect: true }),
      punch({ id: 'other-kind', user_id: 'u5' }),
      punch({ id: 'other-day', business_date: '2026-10-05' }),
    ],
  });
  assert.deepEqual([...(await review.punchIdsAwaitingRequests(service))], ['handed-off']);
  assert.deepEqual([...(await review.punchIdsAwaitingRequests(service, ['u3']))], []);
});

test('settling with a request closes only the clean held check-in of that day', async () => {
  const rows = [
    punch({ id: 'clean' }),
    punch({ id: 'suspect', is_vpn_suspect: true }),
    punch({ id: 'decided', review_status: 'approved' }),
    punch({ id: 'other-user', user_id: 'u9' }),
  ];
  const service = fakeService({ hr_attendance: rows });
  const ids = await review.settleCheckInWithRequest(service, {
    userId: 'u1', businessDate: '2026-10-04', outcome: 'approved', actorId: 'hr1',
  });
  assert.deepEqual([...ids], ['clean']);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.clean.review_status, 'approved');
  assert.equal(byId.clean.reviewed_by, 'hr1');
  assert.equal(byId.clean.review_note, review.AUTO_SETTLE_NOTE);
  assert.equal(byId.suspect.review_status, 'pending');
  assert.equal(byId['other-user'].review_status, 'pending');
});

test('an absent/leave settlement dismisses the held check-in', async () => {
  const rows = [punch({ id: 'clean' })];
  await review.settleCheckInWithRequest(fakeService({ hr_attendance: rows }), {
    userId: 'u1', businessDate: '2026-10-04', outcome: 'rejected', actorId: 'hr1',
  });
  assert.equal(rows[0].review_status, 'rejected');
});
