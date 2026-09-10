const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { NextResponse } = require('next/server');

function load(file, imports) {
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('module', 'exports', 'require', js)(mod, mod.exports, name => {
    if (name in imports) return imports[name];
    throw Error(`Unexpected dependency: ${name}`);
  });
  return mod.exports;
}
const helpers = load('src/lib/hr/leave-overlap.ts', {});
const leaves = load('src/lib/hr/leaves.ts', {});

(async () => {
  let tests = 0;
  for (const route of ['ess/leaves', 'leaves', 'leaves/[id]/decide']) {
    for (const status of ['approved', 'pending', 'db-error']) {
      let overlapChecked = false;
      const service = { from(table) {
        let single = false;
        let exclude = null;
        const q = {
          select() { return q; }, eq() { return q; }, lte() { return q; }, gte() { return q; },
          in(_, statuses) { assert.deepEqual(statuses, ['pending', 'approved']); return q; },
          neq(_, id) { exclude = id; return q; }, order() { return q; },
          maybeSingle() { single = true; return q; },
          then(resolve, reject) {
            let result;
            if (table === 'hr_employees') result = { data: { id: 'emp', company_id: 'company' }, error: null };
            else if (table === 'hr_leaves' && single) result = { data: {
              id: 'current', status: 'pending', user_id: 'employee', store_id: null,
              from_date: '2026-08-31', to_date: '2026-09-02',
            }, error: null };
            else if (table === 'hr_leaves') {
              overlapChecked = true;
              if (route.endsWith('decide')) assert.equal(exclude, 'current');
              result = { data: status === 'db-error' ? null : [{ id: 'old', status,
                from_date: '2026-08-31', to_date: '2026-09-02', leave_type: { name_th: 'ลากิจ' } }],
                error: status === 'db-error' ? { message: 'offline' } : null };
            } else throw Error(`Unexpected DB access: ${table}`);
            return Promise.resolve(result).then(resolve, reject);
          },
        }; return q;
      } };
      const authorized = async () => ({ ok: true, userId: 'manager' });
      const imports = {
        'next/server': { NextResponse },
        '@/lib/supabase/server': { createServiceClient: () => service, createClient: async () => ({
          auth: { getUser: async () => ({ data: { user: { id: 'employee' } } }) },
        }) },
        '@/lib/hr/leave-overlap': helpers,
        '@/lib/hr/leaves': leaves,
        '@/lib/hr/route-auth': { requireHrManager: authorized, requireStoreManager: authorized,
          requireHrManagerForEmployeeProfile: authorized },
        '@/lib/hr/leave-quota': {}, '@/lib/hr/audit': {}, '@/lib/hr/notify': {},
        '@/lib/utils/date': {}, '@/lib/hr/employee-name-map': {}, '@/lib/hr/period-lock': {},
        '@/lib/notifications/service': {},
      };
      const handler = load(`src/app/api/hr/${route}/route.ts`, imports).POST;
      const body = { user_id: 'employee', leave_type_id: 'bereavement', from_date: '2026-08-31',
        to_date: '2026-09-02', reason: 'test', decision: 'approved', override_quota: true };
      const request = { json: async () => body, formData: async () => new Map(Object.entries(body)) };
      const response = await handler(request, { params: Promise.resolve({ id: 'current' }) });
      const json = await response.json();
      assert.equal(response.status, status === 'db-error' ? 500 : 409);
      assert.equal(overlapChecked, true);
      if (status !== 'db-error') {
        assert.equal(json.code, 'leave_overlap');
        assert.ok(json.error.includes(status === 'pending' ? 'รออนุมัติ' : 'อนุมัติแล้ว'));
      }
      tests++;
    }
  }
  console.log(`PASS: ${tests} route scenarios; conflict/error stops all 3 routes before writes, quota override cannot bypass`);
})().catch(e => { console.error(e); process.exitCode = 1; });
