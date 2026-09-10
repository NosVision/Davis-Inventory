/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const { test } = require('node:test');

function loadPolicy() {
  const file = path.resolve('src/lib/hr/attendance-geofence-policy.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports }, { filename: file });
  return exports;
}

const { decideAttendanceGeofence } = loadPolicy();
const decide = (input) => ({ ...decideAttendanceGeofence(input) });

test('allows attendance inside the branch radius', () => {
  assert.deepEqual(
    decide({ distanceM: 100, radiusM: 150, allowOutsideGeofence: false, outsideMaxDistanceM: 500 }),
    { outcome: 'inside', allowedDistanceM: 150 },
  );
});

test('rejects attendance outside the radius when outside attendance is disabled', () => {
  assert.deepEqual(
    decide({ distanceM: 151, radiusM: 150, allowOutsideGeofence: false, outsideMaxDistanceM: 500 }),
    { outcome: 'rejected', allowedDistanceM: 150 },
  );
});

test('marks enabled outside attendance as pending within its maximum distance', () => {
  assert.deepEqual(
    decide({ distanceM: 300, radiusM: 150, allowOutsideGeofence: true, outsideMaxDistanceM: 500 }),
    { outcome: 'outside_pending', allowedDistanceM: 500 },
  );
});

test('rejects enabled outside attendance beyond its maximum distance', () => {
  assert.deepEqual(
    decide({ distanceM: 501, radiusM: 150, allowOutsideGeofence: true, outsideMaxDistanceM: 500 }),
    { outcome: 'rejected', allowedDistanceM: 500 },
  );
});

test('normalizes an enabled outside maximum below the radius to the radius', () => {
  assert.deepEqual(
    decide({ distanceM: 151, radiusM: 150, allowOutsideGeofence: true, outsideMaxDistanceM: 100 }),
    { outcome: 'rejected', allowedDistanceM: 150 },
  );
});
