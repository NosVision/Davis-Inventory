import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
process.env.NEXT_PUBLIC_APP_URL = process.cwd().replaceAll('\\', '/') + '/public';
async function main() {
 const pdf = await import('../src/app/(dashboard)/commission/_components/commission-pdf');
 const { buildPaymentRoundData } = await import('../src/app/(dashboard)/commission/_components/payment-round-pdf');
 const entries = [{ bill_date: '2026-09-10', receipt_no: 'TEST-01', table_no: '1', subtotal_amount: 1000, commission_amount: 100, net_amount: 97.25, notes: 'ตรวจสอบหมายเหตุภาษาไทย' }];
 const payment = { type: 'ae_commission', month: '2026-09', status: 'paid', paid_at: '2026-09-10T08:00:00Z', notes: 'ส่งใบ 50 ทวิทางอีเมล', ae_profile: { name: 'นายทดสอบ ใจดี', nickname: 'ทดสอบ', email: 'ae@example.com', bank_name: 'กสิกรไทย', bank_account_no: '1234567890', bank_account_name: 'นายทดสอบ ใจดี' }, entries };
 const ae = await buildPaymentRoundData(payment);
 assert.equal(ae.cover?.[0].paid,97.25); assert.equal(ae.groups[0].email,'ae@example.com');
 const cancelled = await buildPaymentRoundData({...payment,status:'cancelled'});
 assert.equal(cancelled.cover?.[0].paid,0); assert.equal(cancelled.cover?.[0].outstanding,97.25);
 const bottleEntries = [{bill_date:'2026-09-10',receipt_no:'BTL-01', bottle_product_name:'น้ำดื่ม',bottle_count:3,bottle_rate:20.25,net_amount:60.75,payment_id:'payment',notes:'ทดสอบค่าคอมขวด'}];
 const bottle = await buildPaymentRoundData({...payment,type:'bottle_commission',ae_profile:undefined,entries:bottleEntries});
 assert.equal(bottle.groups[0].totals.bottles,3); assert.equal(bottle.groups[0].ae_name,'ไม่ระบุพนักงาน');assert.equal(bottle.cover?.[0].paid,60.75);
 assert.equal(pdf.bottlePaid(bottleEntries,n=>n??0),60.75);
 const rounded=await buildPaymentRoundData({...payment,type:'bottle_commission',entries:bottleEntries},true);assert.equal(rounded.grand.net,61);assert.equal(rounded.groups[0].rows[0].bottle_rate,20.25);
 const mixed={...ae,cover:[...ae.cover!,...bottle.cover!],groups:[...ae.groups,...bottle.groups],grand:{...ae.grand,net:158,bill_count:2,bottles:3}};
 const long = await buildPaymentRoundData({...payment,entries:Array.from({length:75},(_,i)=>({...entries[0],bill_date:`2026-09-${String(i%28+1).padStart(2,'0')}`,receipt_no:`LONG-${i}`}))});
 await fs.mkdir('tmp/commission-check',{recursive:true});
 for(const [name,data] of Object.entries({ae,bottle,mixed,cancelled,long})) {
   const blob=await pdf.buildCommissionPdf(data);
   await fs.writeFile(`tmp/commission-check/${name}.pdf`,Buffer.from(await blob.arrayBuffer()));
 }
 console.log('PASS: AE/bottle totals, cancellation, unnamed staff, rounding, 5 rendered PDFs');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
