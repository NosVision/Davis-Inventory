/* eslint-disable @typescript-eslint/no-require-imports -- Node's built-in test runner loads this CommonJS harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');

function loadDashboardHelpers() {
  const file = path.resolve('src/lib/hr/attendance-review-notifications.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, () => ({}));
  return mod.exports;
}

const { latestHrAttendanceReviewNotificationId } = loadDashboardHelpers();

test('uses the newest attendance-review notification id as the badge refresh key', () => {
  assert.equal(
    latestHrAttendanceReviewNotificationId([
      { id: 'attendance-new', type: 'hr_attendance_review' },
      { id: 'attendance-old', type: 'hr_attendance_review' },
    ]),
    'attendance-new'
  );
});

test('ignores unrelated notifications when deriving the attendance refresh key', () => {
  assert.equal(
    latestHrAttendanceReviewNotificationId([
      { id: 'leave-new', type: 'hr_leave_request' },
      { id: 'attendance-existing', type: 'hr_attendance_review' },
    ]),
    'attendance-existing'
  );
  assert.equal(
    latestHrAttendanceReviewNotificationId([{ id: 'leave-only', type: 'hr_leave_request' }]),
    null
  );
});
