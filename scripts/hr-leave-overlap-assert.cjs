const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('src/lib/hr/leave-overlap.ts', 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(mod, mod.exports);
const { checkLeaveOverlap } = mod.exports;

function client(rows, error = null) {
  return { from(table) {
    assert.equal(table, 'hr_leaves');
    let selected = rows;
    const q = {
      select() { return q; },
      eq(k, v) { selected = selected.filter(r => r[k] === v); return q; },
      neq(k, v) { selected = selected.filter(r => r[k] !== v); return q; },
      in(k, vs) { selected = selected.filter(r => vs.includes(r[k])); return q; },
      lte(k, v) { selected = selected.filter(r => r[k] <= v); return q; },
      gte(k, v) { selected = selected.filter(r => r[k] >= v); return q; },
      order() { return q; },
      then(resolve, reject) { return Promise.resolve({ data: selected, error }).then(resolve, reject); },
    }; return q;
  } };
}
const row = { id: 'old', user_id: 'employee', from_date: '2026-08-31', to_date: '2026-09-02',
  status: 'approved', leave_type: { name_th: 'ลากิจ' } };
const lookup = { profileId: 'employee', fromDate: '2026-09-02', toDate: '2026-09-04' };
(async () => {
  for (const status of ['pending', 'approved']) {
    const result = await checkLeaveOverlap(client([{ ...row, status }]), lookup);
    assert.equal(result?.code, 'leave_overlap');
    assert.match(result.error, /ลากิจ/);
    assert.ok(result.error.includes(status === 'approved' ? 'อนุมัติแล้ว' : 'รออนุมัติ'));
    assert.ok(result.error.includes('31/08/2569'));
    assert.equal(result.conflicts.length, 1);
  }
  for (const changed of [{ status: 'cancelled' }, { status: 'rejected' }, { user_id: 'other' },
    { to_date: '2026-09-01' }, { from_date: '2026-09-05' }]) {
    assert.equal(await checkLeaveOverlap(client([{ ...row, ...changed }]), lookup), null);
  }
  assert.equal(await checkLeaveOverlap(client([row]), { ...lookup, excludeLeaveId: 'old' }), null);
  assert.equal((await checkLeaveOverlap(client([row]), { ...lookup, fromDate: '2026-08-01', toDate: '2026-09-30' })).conflicts.length, 1);
  assert.equal((await checkLeaveOverlap(client([row]), { ...lookup, fromDate: '2026-09-01', toDate: '2026-09-01' })).conflicts.length, 1);
  await assert.rejects(checkLeaveOverlap(client([], { message: 'offline' }), lookup), /ตรวจสอบ/);
  console.log('PASS: approved/pending, inclusive overlap, containment, cancelled/rejected, other employee, self exclusion, DB failure');
})().catch(e => { console.error(e); process.exitCode = 1; });
