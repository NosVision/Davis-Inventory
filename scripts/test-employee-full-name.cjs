/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test harness. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// employees.ts now imports normalizeFullName from ./employee-name (2026-09-19), so the harness
// resolves sibling .ts files through require() instead of evaluating one file in a bare sandbox.
require.extensions['.ts'] = (mod, filename) => {
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  mod._compile(js, filename);
};
const api = require(path.resolve('src/lib/hr/employees.ts'));

// Every writer of full_name stores the ONE canonical spelling (client report 2026-09-07/09):
// Thai honorific glued to the given name, English honorific dotted with a single space.
const CASES = [
  ['นาย สมชาย ใจดี', 'นายสมชาย ใจดี'],
  ['นายสมชาย ใจดี', 'นายสมชาย ใจดี'],
  ['Mr. Myo min chit', 'Mr. Myo min chit'],
  ['mr Myo min chit', 'Mr. Myo min chit'],
  ['Ms. Nan Lao Oo', 'Ms. Nan Lao Oo'],
  ['San Oo Lwin', 'San Oo Lwin'],
];
for (const partial of [true, false]) {
  for (const [typed, stored] of CASES) {
    test(`stores the canonical official name (${partial ? 'edit' : 'create'}): ${typed} → ${stored}`, () => {
      const result = api.pickEmployeeFields({ full_name: `  ${typed}  ` }, partial);
      assert.equal(result.ok, true);
      assert.equal(result.fields.full_name, stored);
      assert.equal('display_name' in result.fields, false);
    });
  }
}
test('blank official name is stored as null, not an empty string', () => {
  assert.equal(api.pickEmployeeFields({ full_name: '   ' }, true).fields.full_name, null);
  assert.equal(api.pickEmployeeFields({ full_name: null }, true).fields.full_name, null);
});
test('unrelated partial edit leaves official name untouched', () => {
  const result = api.pickEmployeeFields({ notes: 'test', display_name: 'Nickname' }, true);
  assert.equal(result.ok, true);
  assert.equal('full_name' in result.fields, false);
});
for (const value of [42, {}, [], 'x'.repeat(301)]) {
  test(`rejects invalid official name: ${JSON.stringify(value).slice(0, 30)}`, () => {
    assert.equal(api.pickEmployeeFields({ full_name: value }, true).ok, false);
  });
}
