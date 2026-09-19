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
  // The gate imports geo through the tsconfig alias, which plain require cannot resolve.
  const resolve = (name) => (name === '@/lib/hr/geo' ? loadModule('src/lib/hr/geo.ts') : require(name));
  new Function('module', 'exports', 'require', code)(mod, mod.exports, resolve);
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

// --- re-check throttling (2026-09-17 flicker) ---

test('the first GPS fix always triggers the branch preflight', () => {
  const { shouldRecheckLocationGate } = loadModule('src/lib/hr/checkin-location-gate.ts');
  assert.equal(shouldRecheckLocationGate(null, { lat: 13.75, lng: 100.5, at: 1_000 }), true);
});

test('a fix a few metres from the verified one, seconds later, does not re-run the preflight', () => {
  const { shouldRecheckLocationGate } = loadModule('src/lib/hr/checkin-location-gate.ts');
  const verified = { lat: 13.75, lng: 100.5, at: 1_000 };
  // ~5 m north, 1 s later — the "standing still" case that used to blink the buttons.
  assert.equal(shouldRecheckLocationGate(verified, { lat: 13.750045, lng: 100.5, at: 2_000 }), false);
});

test('moving past the distance threshold re-runs the preflight', () => {
  const { shouldRecheckLocationGate } = loadModule('src/lib/hr/checkin-location-gate.ts');
  const verified = { lat: 13.75, lng: 100.5, at: 1_000 };
  // ~33 m north.
  assert.equal(shouldRecheckLocationGate(verified, { lat: 13.7503, lng: 100.5, at: 2_000 }), true);
});

test('a verified fix older than the age threshold is re-verified even without moving', () => {
  const { shouldRecheckLocationGate, GATE_RECHECK_AGE_MS } = loadModule('src/lib/hr/checkin-location-gate.ts');
  const verified = { lat: 13.75, lng: 100.5, at: 1_000 };
  assert.equal(shouldRecheckLocationGate(verified, { lat: 13.75, lng: 100.5, at: 1_000 + GATE_RECHECK_AGE_MS }), true);
});
