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

const { normalizeFullName } = loadModule('src/lib/hr/employee-name.ts');

test('Thai honorific is glued to the given name, whatever spacing was typed', () => {
  assert.equal(normalizeFullName('นาย สมชาย ใจดี'), 'นายสมชาย ใจดี');
  assert.equal(normalizeFullName('นายสมชาย ใจดี'), 'นายสมชาย ใจดี');
  assert.equal(normalizeFullName('  นางสาว   อาทร   มาดหมาย '), 'นางสาวอาทร มาดหมาย');
  assert.equal(normalizeFullName('น.ส. รจนา ป้องคำ'), 'น.ส.รจนา ป้องคำ');
});

test('English honorific gets its dot and exactly one space', () => {
  assert.equal(normalizeFullName('mr pantouch thaintarasit'), 'Mr. pantouch thaintarasit');
  assert.equal(normalizeFullName('Mr.Pantouch Thaintarasit'), 'Mr. Pantouch Thaintarasit');
  assert.equal(normalizeFullName('MISS   Kanya  Dee'), 'Miss Kanya Dee');
});

test('a name without an honorific is only whitespace-normalised, never rewritten', () => {
  assert.equal(normalizeFullName('San Oo Lwin'), 'San Oo Lwin');
  assert.equal(normalizeFullName('นางสาวลักษณ์'), 'นางสาวลักษณ์');
  assert.equal(normalizeFullName('   '), null);
  assert.equal(normalizeFullName(null), null);
});
