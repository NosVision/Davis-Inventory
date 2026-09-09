const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const output = ts.transpileModule(fs.readFileSync('src/lib/hr/employees.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const api = {};
vm.runInNewContext(output, { exports: api });
for (const partial of [true, false]) {
  for (const name of ['นาย สมชาย ใจดี', 'Mr. Myo min chit', 'Ms. Nan Lao Oo']) {
    test(`preserves official name and prefix (${partial ? 'edit' : 'create'}): ${name}`, () => {
      const result = api.pickEmployeeFields({ full_name: `  ${name}  ` }, partial);
      assert.equal(result.ok, true);
      assert.equal(result.fields.full_name, name);
      assert.equal('display_name' in result.fields, false);
    });
  }
}
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
for (const value of [null, '', '   ']) {
  test(`empty official name remains nullable: ${JSON.stringify(value)}`, () => {
    assert.equal(api.pickEmployeeFields({ full_name: value }, true).fields.full_name, null);
  });
}
