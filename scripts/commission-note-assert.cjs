const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {NextResponse}=require('next/server');
const source=ts.transpileModule(fs.readFileSync('src/app/api/commission/wht-certs/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
async function run(body, existing=null, readError=null) {
 let saved;
 const db={auth:{getUser:async()=>({data:{user:{id:'actor'}}})},from(){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:existing,error:readError}),update(v){saved=v;return q},insert(v){saved=v;return q},single:async()=>({data:{id:'row',...existing,...saved},error:null})};return q;}};
 const mod={exports:{}};
 new Function('module','exports','require',source)(mod,mod.exports,name=>name==='next/server'?{NextResponse}:{createClient:async()=>db});
 const response=await mod.exports.POST({json:async()=>({store_id:'store',ae_id:'ae',month:'2026-09',...body})});
 return {status:response.status,saved};
}
(async()=>{
 let result=await run({note:'  นัดรับเอกสาร  '});assert.equal(result.saved.status,'none');assert.equal(result.saved.note,'นัดรับเอกสาร');assert.equal(result.saved.requested_by,undefined);
 result=await run({status:'requested'},{id:'row',status:'none',note:'keep'});assert.equal(result.saved.requested_by,'actor');assert.equal(result.saved.note,'keep');assert.ok(result.saved.requested_at);
 result=await run({note:'แก้ไขหมายเหตุ'},{id:'row',status:'issued',note:'old',issued_by:'original-issuer',issued_at:'2026-09-01'});assert.equal(result.saved.status,'issued');assert.equal(result.saved.issued_by,'original-issuer');assert.equal(result.saved.issued_at,'2026-09-01');
 result=await run({status:'none'},{id:'row',status:'issued',note:'keep'});assert.equal(result.saved.note,'keep');assert.equal(result.saved.issued_by,null);
 result=await run({note:''},{id:'row',status:'requested',note:'clear'});assert.equal(result.saved.note,null);assert.equal(result.saved.status,'requested');
 result=await run({});assert.equal(result.status,400);assert.equal(result.saved,undefined);
 result=await run({status:'bad'});assert.equal(result.status,400);
 result=await run({note:'x'},null,{message:'DB read failed'});assert.equal(result.status,500);assert.equal(result.saved,undefined);
 console.log('COMMISSION_NOTE_ASSERT: 8 scenarios PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
