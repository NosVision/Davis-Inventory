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

const { selectStoreRecipients } = loadModule('src/lib/notifications/recipients.ts');

const NOW = Date.parse('2026-09-19T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(NOW - offsetDays * DAY).toISOString();

const member = (user_id, overrides = {}) => ({
  user_id,
  profiles: {
    id: user_id, role: 'staff', line_user_id: null, active: true, is_system: false,
    last_sign_in_at: iso(1), created_at: iso(200), ...overrides,
  },
});

test('an active member who signed in recently is a recipient', () => {
  const out = selectStoreRecipients([member('a')], { now: NOW });
  assert.deepEqual(out.map((r) => r.user_id), ['a']);
});

test('the person who caused the event is left out', () => {
  const out = selectStoreRecipients([member('a'), member('b')], { now: NOW, excludeUserId: 'a' });
  assert.deepEqual(out.map((r) => r.user_id), ['b']);
});

test('deactivated and system accounts never receive venue notifications', () => {
  const out = selectStoreRecipients(
    [member('off', { active: false }), member('printer', { is_system: true }), member('ok')],
    { now: NOW }
  );
  assert.deepEqual(out.map((r) => r.user_id), ['ok']);
});

test('someone who has not signed in for 30 days is not reading notifications', () => {
  const out = selectStoreRecipients(
    [member('idle', { last_sign_in_at: iso(31) }), member('edge', { last_sign_in_at: iso(29) })],
    { now: NOW }
  );
  assert.deepEqual(out.map((r) => r.user_id), ['edge']);
});

test('a never-signed-in account is kept only while it is new', () => {
  const out = selectStoreRecipients(
    [
      member('fresh', { last_sign_in_at: null, created_at: iso(3) }),
      member('abandoned', { last_sign_in_at: null, created_at: iso(90) }),
      member('unknown', { last_sign_in_at: null, created_at: null }),
    ],
    { now: NOW }
  );
  assert.deepEqual(out.map((r) => r.user_id), ['fresh']);
});

test('the idle window is configurable', () => {
  const out = selectStoreRecipients([member('a', { last_sign_in_at: iso(10) })], { now: NOW, idleAfterDays: 7 });
  assert.deepEqual(out, []);
});
