/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node test harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');

require.extensions['.ts'] = (mod, filename) => {
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const { loadSwapCoworkers } = require('../src/lib/hr/swap-coworkers.ts');

const employee = (id, extra = {}) => ({
  id: `emp-${id}`, profile_id: id, status: 'active', end_date: null,
  full_name: null, work_store_id: 'UPH',
  profile: { id, username: id, display_name: id, active: true, is_system: false },
  ...extra,
});

// Run the actual roster resolver against a small read-only query fixture.
function serviceFor(employees, memberships) {
  return {
    from(table) {
      let rows = table === 'hr_employees' ? employees : memberships;
      const query = {
        select() { return this; },
        eq(key, value) { rows = rows.filter((row) => row[key] === value); return this; },
        in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return this; },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
      };
      return query;
    },
    async rpc() { return { data: [], error: null }; },
  };
}

test('picker excludes disabled, printer, leaver and caller; includes HR-only assignment and probation', async () => {
  const disabled = employee('old-sand');
  disabled.profile.active = false;
  const printer = employee('printer');
  printer.profile.is_system = true;
  const employees = [
    employee('me'), employee('sand'), disabled, printer,
    employee('leaver', { status: 'resigned', end_date: '2026-11-30' }),
    employee('hr-only', { status: 'probation' }),
  ];
  const service = serviceFor(employees, [{ user_id: 'me', store_id: 'UPH' }]);
  const options = await loadSwapCoworkers(service, ['UPH', 'UPH'], 'me', '2026-11-02');
  assert.deepEqual(options.map((person) => person.user_id).sort(), ['hr-only', 'sand']);
});

test('same nickname stays selectable for two active people and duplicate venue memberships collapse', async () => {
  const a = employee('sou1');
  const b = employee('sou2');
  a.profile.display_name = b.profile.display_name = 'Sou';
  const options = await loadSwapCoworkers(serviceFor([a, b], []), ['UPH', 'UPH'], 'me', '2026-11-02');
  assert.equal(options.length, 2);
  assert.notEqual(options[0].name, options[1].name);
});

test('the coworker list includes everyone beyond the first 50 employees', async () => {
  const employees = Array.from({ length: 75 }, (_, index) => employee(`person-${index}`));
  const options = await loadSwapCoworkers(serviceFor(employees, []), ['UPH'], 'me', '2026-11-02');
  assert.equal(options.length, 75);
  assert.ok(options.some((person) => person.user_id === 'person-74'));
});
