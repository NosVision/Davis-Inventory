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

test('employee controls stay disabled while GPS policy is being checked', () => {
  const { areAttendanceControlsBlocked } = loadModule('src/lib/hr/checkin-location-gate.ts');
  assert.equal(areAttendanceControlsBlocked('loading', null), true);
  assert.equal(areAttendanceControlsBlocked('error', null), true);
});

test('employee controls are disabled when the resolved location is blocked', () => {
  const { areAttendanceControlsBlocked } = loadModule('src/lib/hr/checkin-location-gate.ts');
  assert.equal(areAttendanceControlsBlocked('ready', { status: 'blocked' }), true);
});

test('employee controls remain available inside or within an enabled outside allowance', () => {
  const { areAttendanceControlsBlocked } = loadModule('src/lib/hr/checkin-location-gate.ts');
  assert.equal(areAttendanceControlsBlocked('ready', { status: 'inside' }), false);
  assert.equal(areAttendanceControlsBlocked('ready', { status: 'outside_pending' }), false);
});

test('existing no-GPS review flow remains available when location access fails', () => {
  const { areAttendanceControlsBlocked } = loadModule('src/lib/hr/checkin-location-gate.ts');
  assert.equal(areAttendanceControlsBlocked('unavailable', null), false);
});

test('employee controls relock when the last verified GPS position becomes stale', () => {
  const { areAttendanceControlsBlocked } = loadModule('src/lib/hr/checkin-location-gate.ts');
  assert.equal(areAttendanceControlsBlocked('ready', { status: 'inside' }, false), true);
});
