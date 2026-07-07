import { Card, CardTitle, CardSubtitle, Step, TipBox, WarnBox, TableWrap, Th, Td, ManualImg } from '../manual-ui';

export function SectionHrEvaluation() {
  return (
    <>
      {/* ══════════════════════════════════════════ */}
      {/* หน้ารายการงวด (/hr/evaluation)              */}
      {/* ══════════════════════════════════════════ */}
      <Card>
        <CardTitle icon="⭐">ประเมินผล (รายเดือน)</CardTitle>
        <p className="mb-3 text-xs text-gray-400">
          เส้นทาง: <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/evaluation</code>
        </p>

        <CardSubtitle>หน้านี้ใช้ทำอะไร</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หน้า &quot;ประเมินผล (รายเดือน)&quot; เป็นศูนย์กลางให้ฝ่ายบุคคลจัดการรอบการประเมินพนักงานแบบรายเดือน ตั้งแต่ต้นจนจบ คือ สร้างงวดประเมินของเดือนนั้น ๆ, กำหนดว่าใครเป็นผู้ประเมินใคร (มอบหมายผู้ประเมิน), เปิดให้พนักงานเข้าไปให้คะแนนเพื่อนร่วมงาน, ปิดงวดแล้วคำนวณผลออกมาเป็นเปอร์เซ็นต์คะแนน และสุดท้ายแปลงคะแนนเป็นเงินโบนัสหรือเงินหักผ่านสูตรจ่ายเชิงเส้นที่ตั้งไว้
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หน้านี้แบ่งเป็น 2 ระดับ คือ หน้ารายการงวด (หน้าแรกที่เห็น เป็นตารางรวมทุกงวด) และหน้ารายละเอียดของแต่ละงวด (กดชื่องวดเข้าไป) ซึ่งเป็นที่ทำงานจริงทั้งหมด ทั้งการมอบหมาย คำนวณผล ตั้งสูตรจ่าย และอนุมัติรายการเงิน
        </p>

        <CardSubtitle>วิธีเข้าหน้านี้</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เข้าเมนูหลักของฝ่ายบุคคล ที่เส้นทาง <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr</code> (หน้ารวมเมนูแบบตารางไอคอน)</li>
          <li>กดการ์ดที่ชื่อ <strong>ประเมินผล</strong> (ไอคอนรูปดาว)</li>
          <li>ระบบจะพามาที่หน้ารายการงวดประเมิน</li>
        </ol>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          จากนั้นถ้าต้องการทำงานกับงวดใดงวดหนึ่ง ให้กดที่ชื่องวดในตารางเพื่อเข้าหน้ารายละเอียด
        </p>
      </Card>

      {/* ── ส่วนประกอบ: หน้ารายการงวด ── */}
      <Card>
        <CardTitle icon="🗂️">ส่วนประกอบ — หน้ารายการงวด</CardTitle>

        <CardSubtitle>กล่องสร้างงวด (ด้านบน)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ช่อง <strong>สร้างงวด</strong> — พิมพ์ชื่องวด เช่น &quot;ประเมินเดือนกรกฎาคม&quot; (มีข้อความตัวอย่างในช่องว่า &quot;ชื่องวด (เช่น ประเมินเดือนกรกฎาคม)&quot;)</li>
          <li>ช่อง <strong>เดือน</strong> — เลือกเดือนของงวด (ระบบตั้งค่าเริ่มต้นเป็นเดือนปัจจุบันให้)</li>
          <li>ปุ่ม <strong>สร้าง</strong> — กดเพื่อบันทึกงวดใหม่</li>
        </ul>

        <CardSubtitle>ตารางรายการงวด</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>เดือน</strong> — เดือนของงวด (รูปแบบ ปี-เดือน)</li>
          <li><strong>สร้างงวด</strong> — ชื่องวด (กดที่ชื่อเพื่อเข้าหน้ารายละเอียด แสดงเป็นลิงก์สีน้ำเงิน)</li>
          <li><strong>คะแนนเต็ม</strong> — คะแนนเต็มของงวด</li>
          <li><strong>สถานะ</strong> — ป้ายสถานะของงวด (ดูค่าด้านล่าง)</li>
          <li>คอลัมน์สุดท้าย (ไม่มีหัวข้อ) — ปุ่มการกระทำตามสถานะ</li>
        </ul>

        <CardSubtitle>ป้ายสถานะของงวด (4 ค่า)</CardSubtitle>
        <TableWrap>
          <thead>
            <tr><Th>สถานะ</Th><Th>สี</Th><Th>ความหมาย</Th></tr>
          </thead>
          <tbody>
            <tr><Td><span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">ร่าง</span></Td><Td>เหลือง</Td><Td>เพิ่งสร้าง ยังไม่เปิดให้ประเมิน</Td></tr>
            <tr><Td><span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-900 dark:text-sky-300">เปิดให้ประเมิน</span></Td><Td>ฟ้า</Td><Td>พนักงานเข้าไปให้คะแนนได้แล้ว</Td></tr>
            <tr><Td><span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">ปิดแล้ว</span></Td><Td>เขียว</Td><Td>ปิดรับคะแนนแล้ว พร้อมคำนวณผล</Td></tr>
            <tr><Td><span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">ยกเลิก</span></Td><Td>เทา</Td><Td>งวดถูกยกเลิก</Td></tr>
          </tbody>
        </TableWrap>

        <CardSubtitle>ปุ่มการกระทำในตาราง (ปรากฏตามสถานะ)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ปุ่ม <strong>เปิดให้ประเมิน</strong> — แสดงเฉพาะเมื่อสถานะเป็น &quot;ร่าง&quot;</li>
          <li>ปุ่ม <strong>ปิดงวด</strong> — แสดงเฉพาะเมื่อสถานะเป็น &quot;เปิดให้ประเมิน&quot; (กดแล้วมีข้อความยืนยัน &quot;ปิดงวดนี้? หลังปิดจะคำนวณผลได้&quot;)</li>
          <li>ปุ่ม <strong>ยกเลิก</strong> — แสดงเมื่อสถานะเป็น &quot;ร่าง&quot; หรือ &quot;เปิดให้ประเมิน&quot; (กดแล้วมีข้อความยืนยัน &quot;ยกเลิกงวดนี้?&quot;)</li>
        </ul>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          ถ้ายังไม่มีงวดใด ๆ ระบบจะแสดงข้อความ &quot;ยังไม่มีงวดประเมิน&quot;
        </p>

        <ManualImg name="hr-evaluation-01-overview.png" desc="หน้ารายการงวดประเมิน พร้อมกล่องสร้างงวดและตารางรวมทุกงวด" />
      </Card>

      {/* ── ขั้นตอน: หน้ารายการงวด ── */}
      <Card>
        <CardTitle icon="🧭">ขั้นตอนการทำงาน (จากหน้ารายการงวด)</CardTitle>

        <CardSubtitle>สร้างงวดประเมินใหม่</CardSubtitle>
        <Step num={1} title="กรอกชื่องวดและเลือกเดือน">
          <p>ที่หน้ารายการงวด กรอกชื่องวดในช่อง &quot;สร้างงวด&quot; และเลือกเดือน</p>
        </Step>
        <Step num={2} title='กดปุ่ม "สร้าง"'>
          <p>บันทึกงวดใหม่</p>
        </Step>
        <Step num={3} title="ระบบสร้างงวดให้">
          <p>ระบบขึ้นข้อความ &quot;สร้างงวดแล้ว&quot; และงวดใหม่จะปรากฏในตารางด้วยสถานะ &quot;ร่าง&quot; (ระบบสร้างเกณฑ์การประเมินมาตรฐานให้อัตโนมัติ และตั้งคะแนนเต็มให้ตามเกณฑ์นั้น)</p>
        </Step>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>หากไม่ได้กรอกชื่อหรือเดือน จะขึ้นเตือน &quot;กรอกชื่อและเดือน&quot;</li>
          <li>ระบบอนุญาตให้สร้างหลายงวดในเดือนเดียวกันได้ (ไม่บล็อกเดือนซ้ำ)</li>
        </ul>

        <CardSubtitle>เปิดงวดให้พนักงานประเมิน</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กลับไปหน้ารายการงวด</li>
          <li>กดปุ่ม <strong>เปิดให้ประเมิน</strong> ที่แถวของงวดนั้น</li>
          <li>สถานะเปลี่ยนเป็น &quot;เปิดให้ประเมิน&quot; — พนักงานที่ถูกมอบหมายจะเข้าไปให้คะแนนได้ที่หน้าประเมินเพื่อนของตัวเอง</li>
        </ol>

        <CardSubtitle>ปิดงวดและคำนวณผล</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เมื่อผู้ประเมินส่งคะแนนครบ (สถานะแต่ละคู่เป็น &quot;ส่งแล้ว&quot;) ให้ไปที่หน้ารายการงวด กดปุ่ม <strong>ปิดงวด</strong> แล้วยืนยัน</li>
          <li>เข้าหน้ารายละเอียดงวด กดปุ่ม <strong>คำนวณผล</strong> ในส่วนผลประเมิน</li>
          <li>ระบบขึ้น &quot;คำนวณผลแล้ว&quot; และตารางผลจะแสดงคะแนนเปอร์เซ็นต์ของแต่ละคน (ผู้ที่ยังไม่ส่งคะแนนจะไม่ถูกนับเป็น 0 แต่ถูกตัดออกจากการเฉลี่ย)</li>
        </ol>
      </Card>

      {/* ══════════════════════════════════════════ */}
      {/* หน้ารายละเอียดรอบ (/hr/evaluation/[id])      */}
      {/* ══════════════════════════════════════════ */}
      <Card>
        <CardTitle icon="🛠️">ประเมินผล — รายละเอียดรอบ</CardTitle>
        <p className="mb-3 text-xs text-gray-400">
          เส้นทาง: <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/evaluation/[id]</code>
        </p>

        <CardSubtitle>หน้านี้ใช้ทำอะไร</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หน้านี้คือ &quot;ห้องทำงาน&quot; ของงวดประเมินผลรายเดือนหนึ่งงวด ใช้จัดการทุกอย่างของงวดนั้นตั้งแต่ต้นจนจบ ได้แก่ การมอบหมายว่าใครเป็นผู้ประเมินใคร การกดคำนวณคะแนนหลังผู้ประเมินให้คะแนนครบ การตั้งสูตรแปลงคะแนนเป็นเงิน (โบนัส/หัก) การคำนวณจำนวนเงินของพนักงานแต่ละคน การอนุมัติหรือปฏิเสธรายการเงินเหล่านั้น และการนำรายการที่ติดลบไปหักจากกองทุน Service Charge (SC) ของเดือนเดียวกัน
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          พูดง่าย ๆ คือ หน้ารายการงวด (<code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/evaluation</code>) ใช้สร้างและควบคุมสถานะงวด ส่วนหน้านี้คือที่ที่ HR ลงมือทำงานจริงกับพนักงานรายคนภายในงวด ทั้งคะแนนและเงิน เป็นหน้าสำหรับผู้ดูแลระบบ HR เท่านั้น (ต้องมีสิทธิ์ผู้จัดการ HR จึงจะเปิดและใช้งานได้)
        </p>

        <CardSubtitle>วิธีเข้าหน้านี้</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เข้าเมนูหลักของ HR ที่หน้า <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr</code> (หน้าตารางไอคอนเมนู)</li>
          <li>กดไอคอน <strong>ประเมินผล (รายเดือน)</strong> เพื่อเข้าหน้ารายการงวด <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/evaluation</code></li>
          <li>ในตารางรายการงวด กดที่ <strong>ชื่องวด</strong> ในแถวที่ต้องการ ระบบจะพาเข้ามาที่หน้ารายละเอียดรอบนี้</li>
        </ol>
        <TipBox>
          ต้องมีงวดอยู่ก่อนแล้ว ถ้ายังไม่มีให้สร้างงวดที่หน้ารายการ (<code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/evaluation</code>) โดยกรอกชื่องวดและเลือกเดือน แล้วกดสร้าง
        </TipBox>

        <ManualImg name="hr-evaluation-detail-01-overview.png" desc="ภาพรวมหน้ารายละเอียดรอบประเมิน แสดงหัวข้องวด สถานะ และทุกส่วนเรียงจากบนลงล่าง" />
      </Card>

      {/* ── ส่วนที่ 1: มอบหมายผู้ประเมิน ── */}
      <Card>
        <CardTitle icon="👥">1) มอบหมายผู้ประเมิน</CardTitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          ด้านบนหน้ามีลิงก์ <strong>กลับ</strong> (ไอคอนลูกศรซ้าย) เพื่อกลับไปหน้ารายการงวด ถัดมาเป็นหัวข้อชื่องวด พร้อมบรรทัดย่อยบอกเดือนและคะแนนเต็ม (เช่น <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">2026-07 · 100 pts</code>) และป้ายสถานะงวดที่มุมขวา การเปลี่ยนสถานะงวด (เปิด/ปิด/ยกเลิก) ทำที่หน้ารายการ ไม่ได้ทำที่หน้านี้ ถ้าเปิดหน้าแล้วขึ้นข้อความ <strong>ไม่พบงวด</strong> แปลว่ารหัสงวดใน URL ไม่ถูกต้องหรือถูกลบไปแล้ว
        </p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>รายการคู่การมอบหมาย แสดงในรูปแบบ &quot;ชื่อผู้ประเมิน &rarr; ชื่อผู้ถูกประเมิน&quot; พร้อมป้ายสถานะของแต่ละคู่:
            <ul className="mt-1.5 ml-5 list-disc space-y-1">
              <li><span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">รอประเมิน</span> (เหลือง) — ผู้ประเมินยังไม่ได้ส่งคะแนน</li>
              <li><span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">ส่งแล้ว</span> (เขียว) — ผู้ประเมินส่งคะแนนแล้ว</li>
            </ul>
          </li>
          <li>ปุ่มถังขยะท้ายแต่ละแถว = <strong>ลบ</strong> คู่การมอบหมายนั้น</li>
          <li>ด้านล่างมีช่องเลือก <strong>ผู้ประเมิน</strong> และ <strong>ผู้ถูกประเมิน</strong> (dropdown รายชื่อพนักงาน) และปุ่ม <strong>เพิ่ม</strong> เพื่อสร้างคู่ใหม่</li>
          <li>ถ้ายังไม่มีคู่ใด ๆ จะแสดง &quot;ยังไม่มีการมอบหมาย&quot;</li>
        </ul>
        <ManualImg name="hr-evaluation-02-assignments.png" desc="ส่วนมอบหมายผู้ประเมิน แสดงคู่ผู้ประเมินและช่องเลือกเพิ่มคู่ใหม่" />

        <CardSubtitle>ขั้นที่ 1 — มอบหมายผู้ประเมิน (ขั้นตอน)</CardSubtitle>
        <Step num={1} title="เลือกผู้ประเมินและผู้ถูกประเมิน">
          <p>ที่ส่วน &quot;มอบหมายผู้ประเมิน&quot; เลือก <strong>ผู้ประเมิน</strong> และ <strong>ผู้ถูกประเมิน</strong> จากช่องเลือก</p>
        </Step>
        <Step num={2} title='กด "เพิ่ม"'>
          <p>ระบบขึ้น &quot;เพิ่มแล้ว&quot; และคู่ใหม่จะโผล่ในรายการด้านบนพร้อมป้าย &quot;รอประเมิน&quot;</p>
        </Step>
        <Step num={3} title="ลบคู่ที่ไม่ต้องการ">
          <p>กดปุ่มถังขยะท้ายแถวนั้น ระบบขึ้น &quot;ลบแล้ว&quot;</p>
        </Step>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ถ้าไม่ได้เลือกครบทั้งสองช่อง ระบบจะเตือน &quot;เลือกผู้ประเมินและผู้ถูกประเมิน&quot; และจะไม่บันทึก</li>
          <li>หลังมอบหมาย ผู้ประเมินแต่ละคนจะไปให้คะแนนผู้ที่ตนรับผิดชอบผ่านหน้าของฝั่งพนักงาน เมื่อส่งคะแนนแล้ว ป้ายของแถวนั้นจะเปลี่ยนเป็น &quot;ส่งแล้ว&quot;</li>
        </ul>
        <ManualImg name="hr-evaluation-detail-02-assignments.png" desc="ส่วนมอบหมายผู้ประเมิน แสดงรายการคู่ ผู้ประเมินและผู้ถูกประเมิน พร้อมฟอร์มเพิ่มด้านล่าง" />
      </Card>

      {/* ── ส่วนที่ 2: ผลประเมิน ── */}
      <Card>
        <CardTitle icon="📊">2) ผลประเมิน</CardTitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ปุ่ม <strong>คำนวณผล</strong> (ไอคอนเครื่องคิดเลข) ที่มุมขวาของหัวข้อ — รวมคะแนนที่ผู้ประเมินส่งมาเป็นผลต่อพนักงานหนึ่งคน</li>
          <li>ถ้ายังไม่เคยคำนวณจะขึ้นข้อความ &quot;ยังไม่มีผล (คำนวณหลังปิดงวด)&quot;</li>
        </ul>
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">เมื่อมีผลแล้วจะเป็นตาราง 4 คอลัมน์:</p>
        <TableWrap>
          <thead>
            <tr><Th>คอลัมน์</Th><Th>ความหมาย</Th></tr>
          </thead>
          <tbody>
            <tr><Td><strong>พนักงาน</strong></Td><Td>ชื่อผู้ถูกประเมิน</Td></tr>
            <tr><Td><strong>จำนวนผู้ประเมิน</strong></Td><Td>จำนวนผู้ประเมินที่ให้คะแนนคนนี้ (นับเฉพาะคนที่ส่งแล้ว)</Td></tr>
            <tr><Td><strong>คะแนน (%)</strong></Td><Td>คะแนนเฉลี่ยคิดเป็นเปอร์เซ็นต์ (แสดง &mdash; ถ้ายังไม่มีคะแนน)</Td></tr>
            <tr><Td><strong>ดัชนีเวลา</strong></Td><Td>ป้ายวัดวินัยเวลาเข้างานของเดือนเดียวกัน แสดงคะแนนพร้อมระดับ ดีเยี่ยม / ดี / พอใช้ / ควรปรับปรุง (สีต่างกันตามระดับ) เป็นข้อมูลประกอบการตัดสินใจ ไม่ได้รวมเข้ากับคะแนนประเมิน ถ้าไม่มีข้อมูลจะแสดง &mdash;</Td></tr>
          </tbody>
        </TableWrap>
        <ManualImg name="hr-evaluation-03-results.png" desc="ส่วนผลประเมิน แสดงตารางคะแนนเปอร์เซ็นต์และป้ายดัชนีเวลาของแต่ละคน" />

        <CardSubtitle>ขั้นที่ 2 — คำนวณผลคะแนน (ขั้นตอน)</CardSubtitle>
        <Step num={1} title='กดปุ่ม "คำนวณผล"'>
          <p>เมื่อผู้ประเมินให้คะแนนครบ (แนะนำให้ปิดงวดที่หน้ารายการก่อน) กดปุ่มคำนวณผล</p>
        </Step>
        <Step num={2} title="ระบบเฉลี่ยคะแนน">
          <p>ระบบเฉลี่ยคะแนนที่ &quot;ส่งแล้ว&quot; ของแต่ละพนักงานออกมาเป็นเปอร์เซ็นต์ แล้วขึ้นข้อความ &quot;คำนวณผลแล้ว&quot; พร้อมแสดงตารางผล</p>
        </Step>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ผู้ประเมินที่ยังไม่ส่งคะแนนจะไม่ถูกนับเป็น 0 แต่จะถูกตัดออกจากตัวหารเฉลี่ย</li>
          <li>กดซ้ำได้ตลอด ระบบจะคำนวณทับผลเดิม; ยกเว้นงวดที่ถูก <strong>ยกเลิก (void)</strong> จะคำนวณไม่ได้ (ระบบจะแจ้งบันทึกไม่สำเร็จ)</li>
        </ul>
        <ManualImg name="hr-evaluation-detail-03-results.png" desc="ตารางผลประเมิน แสดงคอลัมน์จำนวนผู้ประเมิน คะแนนเปอร์เซ็นต์ และป้ายดัชนีเวลา" />
      </Card>

      {/* ── ส่วนที่ 3: สูตรจ่ายโบนัส ── */}
      <Card>
        <CardTitle icon="🧮">3) สูตรจ่ายโบนัส (เชิงเส้น)</CardTitle>
        <TipBox>
          <strong>จ่าย = ฐาน + (ต่อ 1% &times; คะแนน%) · ติดลบ = หักจาก SC</strong>
        </TipBox>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ช่อง <strong>ฐาน (บาท)</strong> — เงินฐานที่จ่ายทุกคนเท่ากัน (ใส่ค่าติดลบได้ถ้าต้องการให้เป็นการหัก)</li>
          <li>ช่อง <strong>ต่อ 1% (บาท)</strong> — เงินเพิ่มต่อทุก 1% ของคะแนน</li>
          <li>ปุ่ม <strong>บันทึกสูตร</strong> — บันทึกสูตรของงวดนี้</li>
          <li>ปุ่ม <strong>คำนวณเงิน</strong> — นำสูตรไปคูณกับผลคะแนนของแต่ละคน เกิดเป็นรายการจ่าย/หัก</li>
        </ul>
        <ManualImg name="hr-evaluation-04-payout-rule.png" desc="ส่วนสูตรจ่ายโบนัสเชิงเส้น พร้อมช่องฐานและต่อ 1% และปุ่มบันทึกสูตร/คำนวณเงิน" />

        <CardSubtitle>ขั้นที่ 3 — ตั้งสูตรและคำนวณเงิน (ขั้นตอน)</CardSubtitle>
        <Step num={1} title="กรอกสูตรและบันทึก">
          <p>กรอก <strong>ฐาน (บาท)</strong> และ <strong>ต่อ 1% (บาท)</strong> ตามนโยบายโบนัส แล้วกด <strong>บันทึกสูตร</strong> (ขึ้นข้อความ &quot;บันทึกสูตรแล้ว&quot;)</p>
        </Step>
        <Step num={2} title='กด "คำนวณเงิน"'>
          <p>ระบบสร้างรายการจ่าย/หักต่อพนักงานตามสูตร (ขึ้น &quot;คำนวณเงินแล้ว&quot;) ทุกแถวเริ่มที่สถานะ &quot;ร่าง&quot;</p>
        </Step>
        <WarnBox>
          <ul className="ml-4 list-disc space-y-1.5">
            <li>ต้อง <strong>คำนวณผลคะแนน (ขั้นที่ 2) และบันทึกสูตรก่อน</strong> จึงจะคำนวณเงินได้ ถ้ายังไม่มีผลหรือยังไม่ได้ตั้งสูตร ระบบจะแจ้งว่าบันทึกไม่สำเร็จ</li>
            <li>เมื่อกดคำนวณเงินใหม่ ระบบจะสร้างรายการ &quot;ร่าง&quot; ชุดใหม่แทนของเดิม (รายการที่ลงบัญชีเข้าสลิปไปแล้วจะไม่ถูกแตะ) และจะ &quot;แช่แข็ง&quot; สูตรไว้กับรายการนั้น เพื่อไม่ให้การแก้สูตรภายหลังไปเปลี่ยนตัวเลขที่คำนวณไปแล้ว</li>
          </ul>
        </WarnBox>
        <ManualImg name="hr-evaluation-detail-04-payout-rule.png" desc="ส่วนสูตรจ่ายโบนัสและตารางรายการจ่ายหัก แสดงเงินบวกเป็นโบนัส เงินลบเป็นหัก" />
      </Card>

      {/* ── ส่วนที่ 4: รายการจ่าย/หัก ── */}
      <Card>
        <CardTitle icon="💵">4) รายการจ่าย/หัก</CardTitle>
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">ถ้ายังไม่มีจะขึ้นข้อความ &quot;ยังไม่มีรายการ (กดคำนวณเงิน)&quot; ปุ่มที่หัวข้อจะปรากฏตามเงื่อนไข:</p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>อนุมัติทั้งหมด</strong> — ปรากฏเมื่อมีรายการที่ยังเป็น &quot;ร่าง&quot; อย่างน้อยหนึ่งรายการ</li>
          <li><strong>ลงหัก SC</strong> — ปรากฏเมื่อมีรายการที่เป็นเงินติดลบและยังอยู่สถานะ &quot;ร่าง&quot; หรือ &quot;อนุมัติแล้ว&quot;</li>
        </ul>
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">ตาราง 5 คอลัมน์:</p>
        <TableWrap>
          <thead>
            <tr><Th>คอลัมน์</Th><Th>ความหมาย</Th></tr>
          </thead>
          <tbody>
            <tr><Td><strong>พนักงาน</strong></Td><Td>ชื่อผู้ถูกประเมิน</Td></tr>
            <tr><Td><strong>คะแนน (%)</strong></Td><Td>คะแนนที่ใช้คำนวณเงิน</Td></tr>
            <tr><Td><strong>จำนวน (บาท)</strong></Td><Td>โบนัสขึ้นต้นด้วย + สีเขียวและกำกับ &quot;โบนัส&quot;, เงินหักเป็นสีแดงและกำกับ &quot;หัก&quot;</Td></tr>
            <tr><Td><strong>สถานะ</strong></Td><Td>ป้ายสถานะรายการ (ดูด้านล่าง)</Td></tr>
            <tr><Td>คอลัมน์สุดท้าย</Td><Td>ปุ่ม <strong>อนุมัติ</strong> (เฉพาะรายการสถานะ &quot;ร่าง&quot;) และ <strong>ปฏิเสธ</strong> (เมื่อรายการยังเป็น &quot;ร่าง&quot; หรือ &quot;อนุมัติแล้ว&quot;); รายการ &quot;ลงบัญชีแล้ว&quot; หรือ &quot;ถูกแทนที่&quot; จะไม่มีปุ่ม เพราะถือว่าปิดสมบูรณ์แล้ว</Td></tr>
          </tbody>
        </TableWrap>

        <CardSubtitle>ป้ายสถานะรายการจ่าย/หัก</CardSubtitle>
        <TableWrap>
          <thead>
            <tr><Th>สถานะ</Th><Th>สี</Th><Th>ความหมาย</Th></tr>
          </thead>
          <tbody>
            <tr><Td><span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">ร่าง</span></Td><Td>เหลือง</Td><Td>เพิ่งคำนวณ ยังไม่อนุมัติ</Td></tr>
            <tr><Td><span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-900 dark:text-sky-300">อนุมัติแล้ว</span></Td><Td>ฟ้า</Td><Td>อนุมัติแล้ว รอลงบัญชี</Td></tr>
            <tr><Td><span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">ยกเลิก</span></Td><Td>เทา</Td><Td>ถูกปฏิเสธ</Td></tr>
            <tr><Td><span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">ลงบัญชีแล้ว</span></Td><Td>เขียว</Td><Td>ลงหัก SC หรือถูกดึงเข้าสลิปเงินเดือนแล้ว</Td></tr>
            <tr><Td><span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">ถูกแทนที่</span></Td><Td>เทา</Td><Td>ถูกคำนวณใหม่ทับ</Td></tr>
          </tbody>
        </TableWrap>
        <ManualImg name="hr-evaluation-05-payouts.png" desc="ส่วนรายการจ่าย/หัก แสดงยอดโบนัสสีเขียวและเงินหักสีแดงพร้อมปุ่มอนุมัติ" />

        <CardSubtitle>ขั้นที่ 4 — อนุมัติ / ปฏิเสธรายการเงิน</CardSubtitle>
        <Step num={1} title="อนุมัติรายการ">
          <p>ตรวจรายการในตาราง แล้วกด <strong>อนุมัติ</strong> ทีละรายการ หรือกด <strong>อนุมัติทั้งหมด</strong> เพื่ออนุมัติทุกรายการที่เป็น &quot;ร่าง&quot; พร้อมกัน (สถานะเปลี่ยนเป็น &quot;อนุมัติแล้ว&quot;)</p>
        </Step>
        <Step num={2} title="ปฏิเสธรายการที่ไม่ต้องการ">
          <p>กด <strong>ปฏิเสธ</strong> สถานะจะเปลี่ยนเป็น &quot;ยกเลิก&quot;</p>
        </Step>
        <TipBox>
          รายการที่เป็นเพียงการคำนวณถือเป็น &quot;ข้อเสนอ&quot; เท่านั้น เฉพาะรายการ <strong>เงินบวกที่อนุมัติแล้ว</strong> เท่านั้นที่จะไหลเข้าสลิปเงินเดือนเป็นโบนัสประเมินตอนทำรอบจ่ายเงินเดือน
        </TipBox>
        <ManualImg name="hr-evaluation-detail-05-approve-apply.png" desc="ตารางรายการจ่ายหักหลังกดอนุมัติ แสดงป้ายสถานะอนุมัติแล้วและปุ่มลงหัก SC" />

        <CardSubtitle>ขั้นที่ 5 — ลงรายการติดลบเป็นการหักจาก SC</CardSubtitle>
        <Step num={1} title='กดปุ่ม "ลงหัก SC"'>
          <p>สำหรับรายการที่เป็นเงินติดลบ (การหัก) กดปุ่มลงหัก SC (ปรากฏเมื่อมีรายการติดลบที่เป็นร่างหรืออนุมัติแล้ว)</p>
        </Step>
        <Step num={2} title="ระบบหักจากส่วนแบ่ง SC">
          <p>ระบบจับคู่พนักงานกับส่วนแบ่ง SC ของ &quot;เดือนเดียวกัน&quot; กับงวดประเมิน แล้วบันทึกเป็นรายการหักในกองทุน SC และขึ้นข้อความ &quot;ลงหัก SC แล้ว&quot; พร้อมบอกจำนวนรายการที่ลงสำเร็จ</p>
        </Step>
        <WarnBox>
          <ul className="ml-4 list-disc space-y-1.5">
            <li>เดือนนั้นต้องมีกองทุน SC และการจัดสรร SC อยู่ก่อน ถ้าไม่มีระบบจะแจ้งให้สร้าง/จัดสรร SC ก่อน</li>
            <li>ถ้ากองทุนของเดือนนั้น &quot;ปิดยอดแล้ว&quot; (finalized) รายการที่เกี่ยวกับกองทุนนั้นจะถูกข้าม; พนักงานที่ไม่มีส่วนแบ่ง SC ในเดือนนั้นก็จะถูกข้ามเช่นกัน</li>
            <li>กดซ้ำได้ ระบบจะล้างรายการหักอัตโนมัติจากการประเมินของรอบก่อนแล้วลงใหม่ (ไม่ซ้ำซ้อน)</li>
            <li>ส่วนเงินโบนัส (ยอดบวก) จะไม่ถูกหักที่นี่ แต่จะไปจ่ายผ่านสลิปเงินเดือนตอนทำ payroll</li>
          </ul>
        </WarnBox>
      </Card>

      {/* ── เชื่อมโยงกับหน้าอื่น ── */}
      <Card>
        <CardTitle icon="🔗">เชื่อมโยงกับหน้าอื่น</CardTitle>
        <TableWrap>
          <thead>
            <tr><Th>หน้า/เมนู</Th><Th>เส้นทาง</Th><Th>ข้อมูลไหลอย่างไร</Th></tr>
          </thead>
          <tbody>
            <tr>
              <Td>ประเมินเพื่อน (ของพนักงาน)</Td>
              <Td><code className="text-xs">/me/evaluations</code></Td>
              <Td>เมื่อ HR &quot;เปิดให้ประเมิน&quot; งวด พนักงานที่ถูกมอบหมายจะเห็นรายชื่อคนที่ต้องประเมินที่นี่ และให้คะแนนส่งกลับมา สถานะคู่จะเปลี่ยนเป็น &quot;ส่งแล้ว&quot;</Td>
            </tr>
            <tr>
              <Td>ผลประเมินของฉัน (ของพนักงาน)</Td>
              <Td><code className="text-xs">/me/evaluation-results</code></Td>
              <Td>หลัง HR ปิดงวดและคำนวณผล พนักงานจะเห็นคะแนนของตัวเองที่นี่ (ผู้ประเมินเป็นนิรนาม)</Td>
            </tr>
            <tr>
              <Td>ค่าบริการ (Service Charge)</Td>
              <Td><code className="text-xs">/hr/service-charge</code></Td>
              <Td>รายการเงินหัก (ยอดติดลบ) เมื่อกด &quot;ลงหัก SC&quot; จะไปหักจากส่วนแบ่งค่าบริการเดือนเดียวกันของพนักงาน ต้องมีกองทุนและการจัดสรร SC ของเดือนนั้นก่อน และกองทุนต้องยังไม่ปิดยอด</Td>
            </tr>
            <tr>
              <Td>เงินเดือน (Payroll)</Td>
              <Td><code className="text-xs">/hr/payroll</code></Td>
              <Td>เงินโบนัส (ยอดบวก) ที่ &quot;อนุมัติแล้ว&quot; จ่ายผ่านสลิปเงินเดือนตอนทำรอบจ่ายเงิน</Td>
            </tr>
            <tr>
              <Td>แดชบอร์ด HR</Td>
              <Td><code className="text-xs">/hr/dashboard</code></Td>
              <Td>มีลิงก์ลัดเข้าหน้าประเมินผล</Td>
            </tr>
            <tr>
              <Td>ดัชนีเวลา / การลงเวลา</Td>
              <Td>ข้อมูลลงเวลาเข้างาน</Td>
              <Td>คอลัมน์ &quot;ดัชนีเวลา&quot; ในตารางผลดึงคะแนนวินัยเวลาเข้างานของเดือนเดียวกันมาแสดงประกอบ (เป็นข้อมูลอ้างอิง ไม่รวมเข้าคะแนนประเมิน)</Td>
            </tr>
          </tbody>
        </TableWrap>
      </Card>

      {/* ── หมายเหตุ / ข้อควรระวัง ── */}
      <Card>
        <CardTitle icon="⚠️">หมายเหตุ / ข้อควรระวัง</CardTitle>
        <ul className="mb-3 ml-5 list-disc space-y-2 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>สิทธิ์การเข้าถึง</strong> — ทุกการกระทำในหน้านี้ (สร้าง/เปิด/ปิด/คำนวณ/อนุมัติ/ลงหัก SC) จำกัดเฉพาะผู้จัดการฝ่ายบุคคลเท่านั้น หากไม่มีสิทธิ์ระบบจะปฏิเสธ</li>
          <li><strong>ลำดับสำคัญ</strong> — ต้องทำตามลำดับ มอบหมาย &rarr; คำนวณผล &rarr; บันทึกสูตร &rarr; คำนวณเงิน &rarr; อนุมัติ &rarr; (ลงหัก SC สำหรับรายการติดลบ) การข้ามขั้น เช่น กดคำนวณเงินก่อนคำนวณผลหรือก่อนบันทึกสูตร ระบบจะแจ้งบันทึกไม่สำเร็จ</li>
          <li><strong>การคำนวณทับ</strong> — การกด &quot;คำนวณผล&quot; และ &quot;คำนวณเงิน&quot; ซ้ำจะทับ/สร้างชุดร่างใหม่เสมอ แต่รายการที่ลงเข้าสลิปเงินเดือนไปแล้วจะไม่ถูกแก้ (การแก้ไขภายหลังใช้วิธี &quot;แทนที่&quot;)</li>
          <li><strong>สูตรถูกแช่แข็ง</strong> — เมื่อคำนวณเงินแล้ว ตัวเลขจะยึดตามสูตร ณ ตอนนั้น การแก้สูตรทีหลังจะไม่เปลี่ยนตัวเลขเดิมจนกว่าจะกดคำนวณเงินใหม่</li>
          <li><strong>งวดที่ยกเลิกแล้วคำนวณผลไม่ได้</strong> — ระบบจะปฏิเสธการคำนวณผลของงวดสถานะ &quot;ยกเลิก (void)&quot;</li>
          <li><strong>ผู้ที่ยังไม่ส่งคะแนน</strong> ไม่ถูกนับเป็น 0 แต่จะถูกตัดออกจากการเฉลี่ย ดังนั้นควรรอให้ผู้ประเมินส่งครบก่อนคำนวณผลเพื่อความแม่นยำ</li>
          <li><strong>ค่าเงินติดลบ</strong> — ช่อง &quot;ฐาน (บาท)&quot; หรือผลรวมที่ออกมาติดลบ หมายถึงเป็นการหัก ไม่ใช่โบนัส ให้ระวังเวลากรอกสูตร</li>
          <li><strong>การลงหัก SC ทำซ้ำได้อย่างปลอดภัย</strong> — หากกด &quot;ลงหัก SC&quot; ซ้ำ ระบบจะล้างรายการหักอัตโนมัติเดิมก่อนแล้วลงใหม่ แต่ต้องมีกองค่าบริการ (SC pool) ของเดือนนั้นอยู่ก่อน (ถ้ายังไม่มีจะลงไม่ได้) และกองนั้นต้องยังไม่ปิดบัญชี พนักงานที่ไม่มีส่วนแบ่งค่าบริการในเดือนนั้นจะถูกข้าม</li>
          <li><strong>ข้อความผิดพลาดที่พบบ่อย</strong> — &quot;โหลดไม่สำเร็จ&quot; (โหลดข้อมูลหน้าไม่ได้ ลองรีเฟรช), &quot;บันทึกไม่สำเร็จ&quot; (การกระทำนั้นทำไม่ได้ตามเงื่อนไข เช่น ยังไม่มีผล/ยังไม่มีสูตร), &quot;ไม่พบงวด&quot; (รหัสงวดไม่ถูกต้องหรือถูกลบไปแล้ว)</li>
        </ul>
      </Card>
    </>
  );
}
