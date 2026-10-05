/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');

// roster.ts imports the pure pieces of ./work-venues, so this harness resolves sibling .ts files
// through require() rather than transpiling one isolated file (same hook as hr-misc-assert.cjs).
require.extensions['.ts'] = (mod, filename) => {
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  mod._compile(js, filename);
};
const roster = require(path.resolve('src/lib/hr/roster.ts'));

const person = (id, extra = {}) => ({
  id: `emp-${id}`,
  profile_id: id,
  status: 'active',
  end_date: null,
  profile: { id, username: id, display_name: null, is_system: false },
  ...extra,
});

test('employed-window: current staff always in, whatever the window', () => {
  assert.equal(roster.isEmployedInWindow({ status: 'active', end_date: null }, '2026-09-01'), true);
  assert.equal(roster.isEmployedInWindow({ status: 'probation', end_date: null }, '2026-09-01'), true);
  // A record with no status yet is still a person on the books.
  assert.equal(roster.isEmployedInWindow({ status: null, end_date: null }, '2026-09-01'), true);
});

test('employed-window: a leaver stays for any window overlapping their employment, then drops off', () => {
  const leaver = { status: 'resigned', end_date: '2026-09-10' };
  assert.equal(roster.isEmployedInWindow(leaver, '2026-09-01'), true, 'final month still lists them');
  assert.equal(roster.isEmployedInWindow(leaver, '2026-09-10'), true, 'last day inclusive');
  assert.equal(roster.isEmployedInWindow(leaver, '2026-09-11'), false, 'gone the day after');
  assert.equal(roster.isEmployedInWindow({ status: 'terminated', end_date: null }, '2026-01-01'), false);
});

test('candidate: needs a linked, non-system login on top of the employed rule', () => {
  assert.equal(roster.isRosterCandidate(person('a'), '2026-09-01'), true);
  assert.equal(roster.isRosterCandidate(person('b', { profile_id: null, profile: null }), '2026-09-01'), false);
  assert.equal(roster.isRosterCandidate(person('c', { profile: null }), '2026-09-01'), false);
  const printer = person('printer', { profile: { id: 'printer', username: 'printer-1', display_name: null, is_system: true } });
  assert.equal(roster.isRosterCandidate(printer, '2026-09-01'), false);
  assert.equal(roster.isRosterCandidate(person('d', { status: 'resigned', end_date: '2026-08-31' }), '2026-09-01'), false);
});

test('candidate: a disabled login drops an employed record, never a leaver in their final window', () => {
  const off = (id, extra = {}) =>
    person(id, { ...extra, profile: { id, username: id, display_name: null, is_system: false, active: false } });
  assert.equal(roster.isRosterCandidate(off('dup'), '2026-10-01'), false, 'duplicate self-registration');
  assert.equal(roster.isRosterCandidate(off('dup2', { status: 'probation' }), '2026-10-01'), false);
  // Offboarding switches the login off while the final month is still owed.
  assert.equal(roster.isRosterCandidate(off('leaver', { status: 'resigned', end_date: '2026-10-10' }), '2026-10-01'), true);
  // A profile without the field (older callers) is unaffected.
  assert.equal(roster.isRosterCandidate(person('legacy'), '2026-10-01'), true);
});

test('venue split: work_store_id decides alone when set', () => {
  const { listed, inactiveHere } = roster.splitByVenueEvidence({
    storeId: 'S1',
    candidates: [
      { profile_id: 'assigned-here', work_store_id: 'S1' },
      { profile_id: 'assigned-elsewhere', work_store_id: 'S2' },
    ],
    // Evidence says the opposite in both cases; the stated fact outranks it.
    memberOf: new Map([
      ['assigned-here', ['S1', 'S2']],
      ['assigned-elsewhere', ['S1']],
    ]),
    worked: new Map([['assigned-here', new Set(['S2'])]]),
  });
  assert.deepEqual(listed, ['assigned-here']);
  assert.deepEqual(inactiveHere, ['assigned-elsewhere']);
});

test('venue split: single-venue members always stay; multi-venue members need evidence here', () => {
  const { listed, inactiveHere } = roster.splitByVenueEvidence({
    storeId: 'S1',
    candidates: [
      { profile_id: 'new-hire', work_store_id: null },
      { profile_id: 'overseer', work_store_id: null },
      { profile_id: 'regular', work_store_id: null },
      { profile_id: 'not-in-map', work_store_id: null },
    ],
    memberOf: new Map([
      ['new-hire', ['S1']],
      ['overseer', ['S1', 'S2', 'S3']],
      ['regular', ['S1', 'S2']],
    ]),
    worked: new Map([
      ['overseer', new Set(['S3'])],
      ['regular', new Set(['S1'])],
    ]),
  });
  assert.deepEqual(listed, ['new-hire', 'regular', 'not-in-map']);
  assert.deepEqual(inactiveHere, ['overseer']);
});

test('schedulable: first id off the roster is named, none when all are on it', () => {
  const ids = new Set(['a', 'b']);
  assert.equal(roster.findNotSchedulable(ids, ['a', 'b']), null);
  assert.equal(roster.findNotSchedulable(ids, ['a', 'zed', 'b']), 'zed');
  assert.equal(roster.findNotSchedulable(new Set(), []), null);
});

test('names: real name leads, then nickname, then login; sort is Thai-collated by that name', () => {
  assert.equal(roster.rosterMemberName({ full_name: ' นายสมชาย ใจดี ', display_name: 'ชาย', username: 'somchai' }), 'นายสมชาย ใจดี');
  assert.equal(roster.rosterMemberName({ full_name: null, display_name: 'ชาย', username: 'somchai' }), 'ชาย');
  assert.equal(roster.rosterMemberName({ full_name: '', display_name: '', username: 'somchai' }), 'somchai');
  assert.equal(roster.rosterMemberName({ full_name: null, display_name: null, username: null }), '—');

  const input = [
    { full_name: 'นายสมชาย', display_name: null, username: 'x' },
    { full_name: 'นางกานดา', display_name: null, username: 'y' },
  ];
  const sorted = roster.sortRosterMembers(input);
  assert.deepEqual(sorted.map((m) => m.full_name), ['นางกานดา', 'นายสมชาย']);
  assert.deepEqual(input.map((m) => m.full_name), ['นายสมชาย', 'นางกานดา'], 'input left untouched');
});
