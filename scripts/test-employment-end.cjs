/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');

function loadModule(file) {
  const code = ts.transpileModule(fs.readFileSync(path.resolve(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

const mod = () => loadModule('src/lib/hr/employment-end.ts');

test('hr_employees.end_date wins whenever it is set', () => {
  const { resolveEmploymentEndDetail } = mod();
  assert.deepEqual(
    resolveEmploymentEndDetail({
      end_date: '2026-09-30',
      offboarding_last_working_date: '2026-09-10',
      offboarding_status: 'draft',
    }),
    { date: '2026-09-30', source: 'employee' }
  );
});

test('an accepted resignation (draft offboarding) ends employment on its last working date', () => {
  const { resolveEmploymentEnd } = mod();
  assert.equal(
    resolveEmploymentEnd({ end_date: null, offboarding_last_working_date: '2026-09-10', offboarding_status: 'draft' }),
    '2026-09-10'
  );
});

test('pending_signoff and completed offboardings also count', () => {
  const { resolveEmploymentEnd } = mod();
  for (const status of ['pending_signoff', 'completed']) {
    assert.equal(
      resolveEmploymentEnd({ end_date: null, offboarding_last_working_date: '2026-09-10', offboarding_status: status }),
      '2026-09-10',
      status
    );
  }
});

test('a cancelled offboarding is a withdrawn resignation — no end date', () => {
  const { resolveEmploymentEnd } = mod();
  assert.equal(
    resolveEmploymentEnd({ end_date: null, offboarding_last_working_date: '2026-09-10', offboarding_status: 'cancelled' }),
    null
  );
});

test('no offboarding and no end_date means still employed', () => {
  const { resolveEmploymentEnd } = mod();
  assert.equal(resolveEmploymentEnd({ end_date: null }), null);
  assert.equal(resolveEmploymentEnd({ end_date: undefined, offboarding_status: 'draft', offboarding_last_working_date: null }), null);
});

test('a completed offboarding dated before the current start_date is a previous employment (rehire)', () => {
  const { resolveEmploymentEnd } = mod();
  assert.equal(
    resolveEmploymentEnd({
      end_date: null,
      start_date: '2026-03-01',
      offboarding_last_working_date: '2025-12-31',
      offboarding_status: 'completed',
    }),
    null
  );
});

test('pickOffboardingEnds keeps one row per person: open beats completed, newest wins, cancelled dropped', () => {
  const { pickOffboardingEnds } = mod();
  const picked = pickOffboardingEnds([
    { user_id: 'a', last_working_date: '2025-12-31', status: 'completed', created_at: '2025-12-01T00:00:00Z' },
    { user_id: 'a', last_working_date: '2026-09-10', status: 'draft', created_at: '2026-09-01T00:00:00Z' },
    { user_id: 'b', last_working_date: '2026-09-15', status: 'cancelled', created_at: '2026-09-01T00:00:00Z' },
    { user_id: 'c', last_working_date: '2026-01-31', status: 'completed', created_at: '2026-01-01T00:00:00Z' },
    { user_id: 'c', last_working_date: '2026-06-30', status: 'completed', created_at: '2026-06-01T00:00:00Z' },
  ]);
  assert.equal(picked.get('a').last_working_date, '2026-09-10');
  assert.equal(picked.has('b'), false);
  assert.equal(picked.get('c').last_working_date, '2026-06-30');
});

test('employmentEndFor resolves an employee row against the picked offboarding map', () => {
  const { pickOffboardingEnds, employmentEndFor } = mod();
  const map = pickOffboardingEnds([
    { user_id: 'a', last_working_date: '2026-09-10', status: 'draft', created_at: '2026-09-01T00:00:00Z' },
  ]);
  assert.deepEqual(
    employmentEndFor({ profile_id: 'a', end_date: null, start_date: '2024-01-01' }, map),
    { date: '2026-09-10', source: 'offboarding' }
  );
  assert.deepEqual(employmentEndFor({ profile_id: 'z', end_date: null }, map), { date: null, source: null });
});
