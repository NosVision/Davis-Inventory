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

const ITEMS = 'src/app/api/hr/inbox/items.ts';

function item(over) {
  return {
    id: 'x',
    type: 'ot',
    user_id: 'u1',
    store_id: 's1',
    company_id: 'cA',
    submitted_at: '2026-09-18T10:00:00Z',
    date: null,
    note: null,
    ...over,
  };
}

test('inbox rows are newest first, ties broken by type then id so polls never reorder equals', () => {
  const { sortInboxItems } = loadModule(ITEMS);
  const rows = [
    item({ id: 'b', type: 'leave', submitted_at: '2026-09-18T10:00:00Z' }),
    item({ id: 'a', type: 'leave', submitted_at: '2026-09-18T10:00:00Z' }),
    item({ id: 'c', type: 'claim', submitted_at: '2026-09-18T10:00:00Z' }),
    item({ id: 'z', type: 'ot', submitted_at: '2026-09-19T08:00:00Z' }),
    item({ id: 'y', type: 'ot', submitted_at: '2026-09-01T08:00:00Z' }),
  ];
  const sorted = sortInboxItems(rows);
  assert.deepEqual(
    sorted.map((r) => r.id),
    ['z', 'c', 'a', 'b', 'y']
  );
  // pure: the input is untouched
  assert.equal(rows[0].id, 'b');
});

test('company filter: a company id, "none" for rows with no company, empty for everything', () => {
  const { filterInboxItems } = loadModule(ITEMS);
  const rows = [
    item({ id: '1', company_id: 'cA' }),
    item({ id: '2', company_id: 'cB' }),
    item({ id: '3', company_id: null }),
  ];
  assert.deepEqual(filterInboxItems(rows, { companyId: 'cA' }).map((r) => r.id), ['1']);
  assert.deepEqual(filterInboxItems(rows, { companyId: 'none' }).map((r) => r.id), ['3']);
  assert.deepEqual(filterInboxItems(rows, { companyId: '' }).map((r) => r.id), ['1', '2', '3']);
  assert.deepEqual(filterInboxItems(rows, {}).map((r) => r.id), ['1', '2', '3']);
});

test('type filter narrows to one request type and combines with the company filter', () => {
  const { filterInboxItems } = loadModule(ITEMS);
  const rows = [
    item({ id: '1', type: 'ot', company_id: 'cA' }),
    item({ id: '2', type: 'leave', company_id: 'cA' }),
    item({ id: '3', type: 'ot', company_id: 'cB' }),
  ];
  assert.deepEqual(filterInboxItems(rows, { type: 'ot' }).map((r) => r.id), ['1', '3']);
  assert.deepEqual(filterInboxItems(rows, { type: 'ot', companyId: 'cB' }).map((r) => r.id), ['3']);
});

test('per-company counts come busiest first and name the company; a null bucket only when used', () => {
  const { countByCompany } = loadModule(ITEMS);
  const names = new Map([
    ['cA', 'Davis Co'],
    ['cB', 'Bar Co'],
  ]);
  const rows = [
    item({ id: '1', company_id: 'cB' }),
    item({ id: '2', company_id: 'cA' }),
    item({ id: '3', company_id: 'cB' }),
  ];
  assert.deepEqual(countByCompany(rows, names), [
    { company_id: 'cB', name: 'Bar Co', count: 2 },
    { company_id: 'cA', name: 'Davis Co', count: 1 },
  ]);
  const withNone = countByCompany([...rows, item({ id: '4', company_id: null })], names);
  assert.deepEqual(withNone[withNone.length - 1], { company_id: null, name: null, count: 1 });
});

test('per-type counts cover every inbox type, zero included, so the filter can show "(0)"', () => {
  const { countByType, INBOX_TYPES } = loadModule(ITEMS);
  const counts = countByType([item({ type: 'resignation' }), item({ type: 'resignation' }), item({ type: 'ot' })]);
  assert.equal(counts.resignation, 2);
  assert.equal(counts.ot, 1);
  assert.equal(counts.paper_slip, 0);
  assert.deepEqual(Object.keys(counts).sort(), [...INBOX_TYPES].sort());
});

test('every inbox type links to a decide page, and unknown query values are not types', () => {
  const { INBOX_HREF, INBOX_TYPES, isInboxType } = loadModule(ITEMS);
  for (const t of INBOX_TYPES) {
    assert.ok(isInboxType(t), t);
    assert.match(INBOX_HREF[t], /^\/hr\//, t);
  }
  assert.equal(isInboxType('bogus'), false);
  assert.equal(isInboxType(null), false);
});
