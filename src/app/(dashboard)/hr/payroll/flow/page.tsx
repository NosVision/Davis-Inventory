import { PageHeader } from '@/components/ui';

// HR reference: the end-to-end payroll flow (rhythm → inputs → formula → operational steps →
// accountant → employee). Static, bilingual-agnostic Thai reference under /hr/payroll/flow.
export const metadata = { title: 'โฟลการทำเงินเดือน' };

const card = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800';

function SectionHead({ n, th, en }: { n: string; th: string; en: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3 border-b border-gray-200 pb-2 dark:border-gray-700">
      <span className="font-mono text-xs font-semibold text-gray-400">{n}</span>
      <h2 className="text-lg font-bold tracking-tight text-gray-900 sm:text-xl dark:text-white">{th}</h2>
      <span className="ml-auto self-center font-mono text-[11px] tracking-wide text-gray-400">{en}</span>
    </div>
  );
}

function Meta({ tone, children }: { tone: 'api' | 'notify' | 'gate'; children: React.ReactNode }) {
  const tones = {
    api: 'text-indigo-600 border-indigo-200 bg-gray-50 dark:text-indigo-300 dark:border-indigo-900/50 dark:bg-gray-800',
    notify: 'text-teal-600 border-teal-200 bg-gray-50 dark:text-teal-300 dark:border-teal-900/50 dark:bg-gray-800',
    gate: 'text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-800/60 dark:bg-amber-900/20',
  };
  return <span className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${tones[tone]}`}>{children}</span>;
}

interface Step { t: string; b: React.ReactNode; meta?: React.ReactNode }
const STEPS: Step[] = [
  { t: 'เลือกบริษัท + เดือนจ่าย', b: <>เลือกงวดจากประวัติ (จอใหญ่ = รายการซ้าย · จอเล็ก = แถบ chip เลื่อนด้านบน) · <b>การ์ดสถานะ</b>บนสุดสรุปงวด/สถานะ/ขั้นตอน พร้อม<b>ปุ่มหลักปุ่มเดียว</b>ที่พาไปขั้นถัดไปเสมอ (ส่งให้บัญชี → ปิดยอด → ประกาศ) — ปุ่มอื่นทั้งหมดอยู่ในเมนู <b>"เพิ่มเติม ▾"</b> (คำนวณใหม่ · Excel · พิมพ์ทดสอบ · Reopen) · ทะเบียนแจกแจงต่อคน (วัน/เงินเดือน/OT/เบี้ย/หักอื่น/สปส./ภาษี/SV/สุทธิ) กดลูกศรหน้าชื่อ<b>กางดูทุกบรรทัด</b>ได้ · ปุ่ม <b>Excel</b> ในเมนูโหลดทะเบียน Payment เต็ม (แยก SS5/SS3 + Remark)</> },
  { t: 'Generate — สร้างรอบ (draft)', b: <>คำนวณสลิปทุกคนตาม input ข้างบน · <b>ดึง SV เดือน N−1</b> เข้ามา · เป็น draft (กด Recompute สร้างใหม่ได้เรื่อยๆ ตราบยังไม่ปิดยอด)</>, meta: <><Meta tone="api">POST /api/hr/payruns</Meta><Meta tone="gate">รอบที่ปิดแล้ว → 409</Meta></> },
  { t: 'ตรวจ/แก้ระหว่าง draft', b: <>แก้<b>รายการประจำ</b> (หน้า "รายการประจำทั้งบริษัท" — ตั้งครั้งเดียว ใช้ทุกเดือน) · ล.ย.01 · <b>รายการเฉพาะงวด</b>: เพิ่ม/ลบรายการรับ-หักครั้งเดียว (กยศ, ค่าเสียหาย, โบนัส) <b>บังคับใส่เหตุผล</b> + ปุ่มคัดลอกจากงวดก่อนแล้วแก้เฉพาะยอด · หมายเหตุ (Remark) ต่อคน · ใส่ภาษีเองเป็น fallback — ทุกการแก้คำนวณสลิปใหม่ให้อัตโนมัติ</>, meta: <Meta tone="api">recurring · tax-allowance · adjustments · remarks · tax-override</Meta> },
  { t: 'ส่งให้บัญชี — สร้างลิงก์ตรวจ', b: <>สร้างลิงก์ <code className="rounded bg-gray-100 px-1 font-mono text-[0.85em] dark:bg-gray-700">/review/&lt;token&gt;</code> + รหัสผ่าน 6 หลัก (อายุ 14 วัน · เก็บเฉพาะ hash) · โชว์ token ครั้งเดียว · ยกเลิกได้</>, meta: <Meta tone="api">GET/POST/DELETE review-link</Meta> },
  { t: 'บัญชีตรวจ (พอร์ทัลสาธารณะ)', b: <>กรอกรหัสก่อนเห็นข้อมูล → ตารางแบบไฟล์ Payment เดิม (เงินเดือน/OT/SV/gross/YTD/ภาษี/net) · <b>กรอกภาษีต่อคน</b> → แจ้ง HR · กด <b>"ตรวจครบแล้ว"</b> → แจ้ง HR · โหลด Excel ได้</>, meta: <><Meta tone="api">payrun-review · taxes · confirm · export</Meta><Meta tone="notify">แจ้ง HR: tax_submitted · review_confirmed</Meta></> },
  { t: 'Finalize — ปิดยอด (ล็อก)', b: <><b>ต้องบัญชี "ตรวจครบ" ก่อน</b> — ถ้ายังไม่ confirm จะบล็อก (409) เว้นแต่ HR ใส่เหตุผล override (บันทึก audit) · <b>เตือนถ้างวดก่อนมีรายการเฉพาะงวดแต่งวดนี้ยังไม่มี</b> (กันลืม กยศ/หักประจำงวด) · ปิดยอดแล้ว <b>mark เบิก/claim เป็นจ่ายแล้ว</b></>, meta: <><Meta tone="api">POST finalize</Meta><Meta tone="gate">gate: accountant_confirmed</Meta></> },
  { t: 'ไฟล์ธนาคาร (CSV)', b: <>เฉพาะรอบที่ปิดยอดแล้ว · เอา <b>net เท่านั้น</b> (ไม่รวม SV/ทิป) + เลขบัญชีพนักงาน · ประทับ "ส่งออกแล้ว" เมื่อมีรายการจ่ายจริง (ติดล็อก reopen)</>, meta: <><Meta tone="api">GET bank-file</Meta><Meta tone="gate">ยังไม่มีปุ่มใน UI</Meta></> },
  { t: 'ประกาศสลิป', b: <>แจ้งพนักงานทุกคน <b>"เงินเดือนออกแล้ว 🎉"</b> ลิงก์ไป /me/payslips · มีกันประกาศซ้ำ</>, meta: <><Meta tone="api">POST announce</Meta><Meta tone="notify">แจ้งพนักงาน: payslip_ready</Meta></> },
  { t: 'Reopen — แก้ย้อนหลัง (ถ้าจำเป็น)', b: <><b>ต้องมีเหตุผล</b> · ถ้าส่งไฟล์ธนาคารไปแล้ว (เงินอาจโอนแล้ว) ต้องยืนยัน <b>force</b> อีกชั้น → คลายล็อก + เคลียร์สถานะส่งออก</>, meta: <><Meta tone="api">POST reopen</Meta><Meta tone="gate">gate: bank_exported → require force</Meta></> },
  { t: 'พิมพ์สลิปกระดาษ', b: 'คิวพิมพ์ = คนตั้งค่ารับกระดาษประจำ หรือขอเป็นรอบ · พิมพ์แล้ว mark + แจ้งพนักงานมารับ', meta: <><Meta tone="api">print-queue</Meta><Meta tone="notify">แจ้งพนักงาน: paper_ready</Meta></> },
];

const INPUTS: { n: 'N' | 'N−1'; title: string; items: React.ReactNode[] }[] = [
  { n: 'N', title: 'เวลางาน → วันทำงาน/OT', items: [<>ตาราง + ลงเวลา (ตัด punch ที่ HR reject) + timesheet override</>, <>→ <b>วันทำงาน</b>, <b>OT</b>, <b>สาย</b>, <b>ขาด</b></>, <><b>Prorate</b> เข้า/ออกกลางเดือน = ÷30</>] },
  { n: 'N', title: 'ลา (อนุมัติแล้ว)', items: [<>หัก<b>เงินเดือน</b> ÷30 × วันลา + หัก<b>ค่าเดินทาง</b> ÷30 × วันลา</>, <>ลากิจ/ป่วยไม่มีใบ → หักหมด · ป่วยมีใบ → เงินเดือนไม่หัก · พักร้อน/นักขัต → ไม่หัก</>, <>นับเฉพาะ<b>วันที่ควรทำงาน</b> (ตัดวันหยุด)</>] },
  { n: 'N', title: 'รายการประจำ (recurring)', items: [<><b>ค่าตอบแทน:</b> ครองชีพ · บ้าน · โทร · <b>เดินทาง</b> · ชดเชยวันหยุด</>, <><b>รายการหักประจำ</b> (กยศ · เบิกล่วงหน้า · เงินประกัน · ผ่อนกู้)</>, <><b>ตั้งครั้งเดียว</b>ที่หน้า "รายการประจำทั้งบริษัท" — ดึงเข้าทุกงวดเอง · ตั้ง<b>เดือนสิ้นสุด</b>ได้ (หมดแล้วหยุดเอง) หรือปล่อยถาวร</>] },
  { n: 'N−1', title: 'กองที่ยกมาเดือนก่อน', items: [<><b>Service Charge สุทธิ</b> = จัดสรร − หัก</>, <><b>ทิปสุทธิ</b></>, <><b>โบนัสประเมิน</b> (ลบ→หัก SV แยก)</>] },
  { n: 'N', title: 'อื่นๆ เข้าสลิป', items: [<><b>เบิก/claim</b> อนุมัติแล้วยังไม่จ่าย</>, <><b>รายการเฉพาะงวด</b> (รับ/หักครั้งเดียว + เหตุผล — โบนัสก็ใส่ทางนี้; เก็บนอกแถวสลิป)</>] },
  { n: 'N', title: 'ฐานภาษี/ประกัน', items: [<><b>ล.ย.01</b> ค่าลดหย่อน</>, <><b>PVD</b> กองทุนสำรองฯ</>, <>วันหยุดนักขัตฤกษ์</>] },
];

const KEY_PTS: [string, React.ReactNode][] = [
  ['💸', <><b>SV / ทิป จ่ายแยกวันที่ 15</b> — ไม่อยู่ในไฟล์โอนเงินเดือน (net) และไม่เข้าฐานภาษี/ปกส. แต่โชว์ในสลิป</>],
  ['🔒', <><b>ปิดยอดต้องรอบัญชี "ตรวจครบ"</b> ก่อน (override ได้ถ้าจำเป็น แต่ต้องมีเหตุผล + audit)</>],
  ['🧾', <><b>เบิก/claim mark จ่ายตอน finalize</b> ไม่ใช่ตอน generate</>],
  ['♻️', <><b>ภาษีที่บัญชีกรอก + รายการเฉพาะงวด เก็บนอกแถวสลิป</b> → Recompute แล้วค่าเดิมยังอยู่</>],
  ['🏦', <><b>Reopen หลังส่งไฟล์ธนาคาร ต้อง force</b> — กันแก้ยอดที่จ่ายไปแล้ว</>],
  ['⚖️', <><b>÷30 คงที่</b> ทั้งหักลาและ prorate · <b>ปกส. SS5 หรือ SS3 อย่างใดอย่างหนึ่ง</b></>],
  ['📅', <><b>รายการประจำไม่ต้องเพิ่มใหม่ทุกเดือน</b> — ตั้งครั้งเดียวใช้ตลอด · ตั้งเดือนสิ้นสุดแล้วระบบหยุดหักเองงวดถัดไป ไม่ต้องจำไปลบ</>],
  ['🛡️', <><b>รายการเฉพาะงวดเพิ่ม/ลบได้เฉพาะ draft</b> · บังคับเหตุผล + บันทึกคนทำทุกครั้ง · <b>ตัวเลขที่ระบบคำนวณ (เงินเดือน/OT/ปกส./หักลา) ห้ามแก้มือเสมอ</b></>],
];

export default function PayrollFlowPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="โฟลการทำเงินเดือน"
        subtitle="รอบ 26 (เดือนก่อน) → 25 · จ่ายสิ้นเดือน · SV/ทิป จ่ายแยกวันที่ 15 และไม่รวมในยอดโอนธนาคาร แต่โชว์ในสลิป"
      />

      {/* legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-gray-500 dark:text-gray-400">
        {[['bg-indigo-500', 'เดือนนี้ / เงินเดือน (N)'], ['bg-teal-500', 'เดือนก่อน / SV·ทิป·ประเมิน (N−1)'], ['bg-amber-500', 'จุดล็อก / ต้องระวัง'], ['bg-emerald-500', 'เงินสุทธิ / จ่าย']].map(([c, l]) => (
          <span key={l} className="inline-flex items-center gap-2"><i className={`h-2.5 w-2.5 rounded-sm ${c}`} />{l}</span>
        ))}
      </div>

      {/* 1 · rhythm */}
      <section>
        <SectionHead n="01" th="จังหวะทั้งเดือน" en="month rhythm" />
        <div className={card}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[15fr_10fr_4fr_3fr]">
            {[
              ['1–15', 'ปิดกอง SV เดือนก่อน (ประเมิน→ยอด→หัก HQ→จัดสรร→ล็อก)', 'bg-teal-50 border-teal-300 dark:bg-teal-900/25 dark:border-teal-700'],
              ['16–25', 'รอรอบเวลางานปิด (25)', 'bg-gray-50 border-gray-200 dark:bg-gray-800/60 dark:border-gray-700'],
              ['26–29', 'ทำเงินเดือน + ส่งบัญชี', 'bg-indigo-50 border-indigo-300 dark:bg-indigo-900/25 dark:border-indigo-700'],
              ['30/31', 'ปิดยอด + จ่าย', 'bg-amber-50 border-amber-400 dark:bg-amber-900/25 dark:border-amber-600'],
            ].map(([d, l, cls]) => (
              <div key={d} className={`rounded-xl border p-3 ${cls}`}>
                <div className="font-mono text-sm font-bold tracking-tight text-gray-900 dark:text-gray-100">{d}</div>
                <div className="mt-0.5 text-xs font-semibold leading-snug text-gray-700 dark:text-gray-300">{l}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 dark:border-gray-600 dark:bg-gray-800/50">
            <span className="rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1 text-[13px] font-semibold text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">เงินเดือนเดือน N</span>
            <span className="text-lg text-gray-400">←</span>
            <span className="text-[13px] text-gray-500 dark:text-gray-400">ถือกอง SV / ทิป / ประเมิน ของ</span>
            <span className="rounded-full border border-teal-300 bg-teal-50 px-3 py-1 text-[13px] font-semibold text-teal-700 dark:border-teal-700 dark:bg-teal-900/30 dark:text-teal-300">เดือน N−1</span>
            <span className="text-[13px] text-gray-500 dark:text-gray-400">(เพราะยอดเดือนก่อนเพิ่งปิดวันที่ 15)</span>
          </div>
          <p className="mt-3 text-[13px] text-gray-500 dark:text-gray-400">หน้า <code className="rounded bg-gray-100 px-1 font-mono text-[0.85em] dark:bg-gray-700">/hr/close</code> คือศูนย์รวมจังหวะนี้ — ขั้น 7–9 (สร้าง/ตรวจ/จ่าย) ลิงก์มาที่หน้าเงินเดือน</p>
        </div>
      </section>

      {/* 2 · inputs */}
      <section>
        <SectionHead n="02" th="Input ที่ระบบดึงเข้ามา (ต่อคน)" en="generate inputs" />
        <p className="-mt-1 mb-3 text-[13px] text-gray-500 dark:text-gray-400">ตอนกด Generate ระบบดึงทุกอย่างของรอบนั้นแบบขนานทีเดียว แล้วประกอบเป็น input ของเครื่องคำนวณสลิปรายคน</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {INPUTS.map((g) => (
            <div key={g.title} className={card}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] font-bold ${g.n === 'N' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300' : 'bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-300'}`}>{g.n}</span>
                {g.title}
              </h3>
              <ul className="space-y-0 text-sm">
                {g.items.map((it, i) => (
                  <li key={i} className="border-b border-dashed border-gray-100 py-1.5 pl-4 last:border-0 dark:border-gray-700/60 relative before:absolute before:left-0.5 before:top-3 before:h-1.5 before:w-1.5 before:rounded-full before:bg-gray-400 before:content-['']">{it}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 3 · formula */}
      <section>
        <SectionHead n="03" th="สูตรคำนวณสลิป" en="computePayslip" />
        <div className={card}>
          <div className="space-y-2 font-mono text-[13.5px] leading-relaxed">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-dashed border-gray-200 pb-2 dark:border-gray-700">
              <span className="min-w-[92px] font-bold">Gross =</span>
              {['เงินเดือน(prorate)', 'OT', 'ค่าตอบแทน'].map((c) => <span key={c} className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{c}</span>)}
              <span className="text-gray-400">+</span>
              {['SV', 'ทิป'].map((c) => <span key={c} className="rounded bg-teal-50 px-2 py-0.5 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">{c}</span>)}
              <span className="text-gray-400">+</span>
              <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">claim/โบนัส/ประเมิน</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-dashed border-gray-200 pb-2 dark:border-gray-700">
              <span className="min-w-[92px] font-bold">หัก =</span>
              <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-900/25 dark:text-amber-300">หักลา (เงินเดือน÷30 · เดินทาง÷30)</span>
              <span className="text-gray-400">+</span>
              <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-900/25 dark:text-amber-300">สาย / ขาด</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-dashed border-gray-200 pb-2 dark:border-gray-700">
              <span className="min-w-[92px] font-bold">+ ปกส. =</span>
              <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-900/25 dark:text-amber-300">SS5% = min(5%×เงินเดือน, ฿875)</span>
              <span className="text-gray-400">หรือ</span>
              <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-900/25 dark:text-amber-300">SS3% = 3%×(เงินเดือน+OT+ค่าตอบแทน)</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="min-w-[92px] font-bold">+ ภาษี =</span>
              <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-900/25 dark:text-amber-300">PND1 ขั้นบันได (ฐาน = เงินเดือน)</span>
              <span className="text-gray-400">หรือ</span>
              <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-900/25 dark:text-amber-300">WHT 3% (ฐาน = gross − SV − ทิป)</span>
              <span className="text-gray-400">+ PVD + หักประจำ</span>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 font-mono text-[15px] font-bold text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-900/25 dark:text-emerald-300">
            Net (โอนธนาคาร) = Gross − หักทั้งหมด − <span className="text-teal-600 dark:text-teal-400">(SV + ทิป)</span>
          </div>
          <div className="mt-3 grid grid-cols-[auto_1fr] gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm dark:border-teal-800/60 dark:bg-teal-900/20">
            <span className="text-lg">💡</span>
            <p className="text-gray-700 dark:text-gray-200"><b>ทำไม net ลบ SV+ทิปออก?</b> เพราะ SV/ทิป <b>จ่ายแยกวันที่ 15</b> ของเดือนถัดไป (ก้อนของตัวเอง) — โชว์ในสลิปให้เห็นรวม แต่ไฟล์โอนเงินเดือน (ปลายเดือน) เอาเฉพาะ net เงินเดือนจริง · ฐานภาษี/ปกส. ก็ไม่รวม SV/ทิป</p>
          </div>
        </div>
      </section>

      {/* 4 · steps */}
      <section>
        <SectionHead n="04" th="ขั้นตอนปฏิบัติ (HR กดอะไร)" en="/hr/payroll" />
        <ol className="space-y-4">
          {STEPS.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-600 font-mono text-sm font-bold text-white">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold text-gray-900 dark:text-white">{s.t}</div>
                <div className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{s.b}</div>
                {s.meta && <div className="mt-1.5 flex flex-wrap gap-1.5">{s.meta}</div>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 5 · employee */}
      <section>
        <SectionHead n="05" th="ฝั่งพนักงาน" en="/me/payslips" />
        <div className={card}>
          <p className="text-sm text-gray-700 dark:text-gray-200">พนักงานเห็น<b>เฉพาะรอบที่ปิดยอดแล้ว</b> (ไม่เห็น draft) · การ์ดแต่ละงวดโชว์ <b>ยอดสุทธิ</b> + สถานะกระดาษ · แตะเปิดดูสลิปเต็ม (ฟอร์ม 9×5.5") · ขอสลิปกระดาษได้ทั้งแบบตั้งค่าประจำหรือรายงวด · แจ้งเตือน "เงินเดือนออกแล้ว" ลิงก์มาหน้านี้ตรงๆ</p>
          <p className="mt-2 text-[13px] text-gray-500 dark:text-gray-400">รวมสลิปย้อนหลังที่ import (ม.ค.–มิ.ย. legacy) แสดงปนกันเรียงตามงวดใหม่สุดบน</p>
        </div>
      </section>

      {/* 6 · key points */}
      <section>
        <SectionHead n="06" th="จุดสำคัญที่ต้องรู้" en="nuances" />
        <div className={card}>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {KEY_PTS.map(([ic, txt], i) => (
              <li key={i} className="flex gap-3 py-2.5 text-sm">
                <span className="text-lg leading-tight">{ic}</span>
                <span className="text-gray-700 dark:text-gray-200">{txt}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
