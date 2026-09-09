const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { NextResponse } = require('next/server');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const source = ts.transpileModule(fs.readFileSync('src/app/api/commission/payment/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
async function run(body, rows) {
  let inserted;
  const filters = [];
  const client = { auth: { getUser: async () => ({ data: { user: { id: A } } }) }, from(table) {
    let data = rows;
    let update = false;
    const q = {
      select() { return q; },
      eq(k,v) { filters.push([k,v]); data = data.filter(r => r[k] === v); return q; },
      is(k,v) { filters.push([k,v]); data = data.filter(r => r[k] == v); return q; },
      gte() { return q; }, lte() { return q; },
      in(k,vs) { data = data.filter(r => vs.includes(r[k])); return q; },
      insert(payload) { inserted = payload; return q; },
      update() { update = true; return q; }, single() { return q; },
      then(resolve, reject) {
        return Promise.resolve({ data: table === 'commission_payments' ? { id: 'payment', ...inserted } : update ? null : data, error: null }).then(resolve,reject);
      },
    }; return q;
  } };
  const mod = { exports: {} };
  new Function('module','exports','require',source)(mod,mod.exports,name => {
    if(name === 'next/server') return { NextResponse };
    if(name === '@/lib/supabase/server') return { createClient: async () => client };
    throw Error(name);
  });
  const res = await mod.exports.POST({ json: async () => ({ store_id: A, type: 'bottle_commission', month:'2026-09', slip_photo_urls:['https://example.com/slip.png'], ...body }) });
  return { status: res.status, json: await res.json(), inserted, filters };
}
const entry = { id: A, store_id:A, type:'bottle_commission', staff_id:null, ae_id:null, net_amount:500, payment_id:null,cancelled_at:null };
(async()=>{
  let count = 0;
  for(const staff_id of [null, undefined, 'no_staff']) {
    for(const explicit of [false,true]) {
      const r = await run({ staff_id, ...(explicit ? {entry_ids:[A]} : {}) }, [entry, {...entry,id:B,staff_id:B}]);
      assert.equal(r.status,201,JSON.stringify(r.json));
      assert.equal(r.inserted.staff_id,null);
      assert.equal(r.inserted.total_amount,500);
      assert.deepEqual(r.inserted.slip_photo_urls,['https://example.com/slip.png']);
      if(!explicit) assert.ok(r.filters.some(([k,v]) => k==='staff_id' && v===null));
      count++;
    }
  }
  const named = await run({staff_id:B,entry_ids:[A]},[{...entry,staff_id:B}]);
  assert.equal(named.status,201); assert.equal(named.inserted.staff_id,B); count++;
  for(const rows of [[entry,{...entry,id:B,staff_id:B}],[{...entry,staff_id:A},{...entry,id:B,staff_id:B}]]) {
    const r=await run({entry_ids:[A,B]},rows); assert.equal(r.status,400); assert.equal(r.inserted,undefined); count++;
  }
  const mismatch=await run({staff_id:A,entry_ids:[B]},[{...entry,id:B,staff_id:B}]);
  assert.equal(mismatch.status,400); assert.equal(mismatch.inserted,undefined); count++;
  const invalid=await run({staff_id:'bad-id'},[entry]); assert.equal(invalid.status,400); count++;
  const ae=await run({type:'ae_commission',ae_id:B,entry_ids:[A]},[{...entry,type:'ae_commission',ae_id:B}]);
  assert.equal(ae.status,201); assert.equal(ae.inserted.ae_id,B); count++;
  console.log(`COMMISSION_PAYMENT_ASSERT: ${count} scenarios PASS`);
})().catch(e=>{console.error(e);process.exitCode=1;});
