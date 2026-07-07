import { Card, CardTitle, CardSubtitle, Step, TipBox, WarnBox, TableWrap, Th, Td, ManualImg } from '../manual-ui';

export function SectionHrDiscipline() {
  return (
    <>
      {/* ═══════════════ ใบเตือน ═══════════════ */}
      <Card>
        <CardTitle icon="⚠️">ใบเตือน</CardTitle>
        <p className="mb-3 text-xs text-gray-400">
          เส้นทาง: <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/warnings</code>
        </p>

        <CardSubtitle>หน้านี้ใช้ทำอะไร</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หน้า &ldquo;ใบเตือน&rdquo; คือที่สำหรับฝ่ายบุคคล (และผู้จัดการสาขา) ใช้ออกและติดตาม &ldquo;ใบเตือนทางวินัย&rdquo; ของพนักงาน เมื่อพนักงานทำผิดระเบียบ คุณสามารถบันทึกใบเตือน ระบุระดับโทษ และผลกระทบต่อ Service Charge (ค่าบริการ) ได้จากที่นี่ ตัวใบเตือนออกแบบให้มีการลงลายมือชื่อร่วมกัน 3 ฝ่าย คือ พนักงาน ผู้จัดการ และฝ่ายบุคคล เพื่อให้เอกสารมีผลสมบูรณ์
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หน้านี้แสดงใบเตือนทั้งหมดในรูปแบบการ์ด พร้อมตัวกรองตามสาขาและสถานะ คุณสามารถออกใบเตือนใหม่ ลงนามในฐานะผู้จัดการหรือฝ่ายบุคคล พิมพ์เอกสารใบเตือนเป็นกระดาษ และยกเลิกใบเตือนที่ออกผิดได้ ส่วนการลงนาม &ldquo;รับทราบ&rdquo; ของตัวพนักงานเองจะทำจากหน้าของพนักงาน (ใบเตือนของฉัน) ไม่ได้ทำจากหน้านี้
        </p>

        <CardSubtitle>วิธีเข้าหน้านี้</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เข้าสู่เมนูหลักของฝ่ายบุคคลที่หน้า <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr</code> (หน้าตารางเมนูแบบช่องสี่เหลี่ยม)</li>
          <li>กดที่ช่อง <strong>ใบเตือน</strong> (ไอคอนรูปสามเหลี่ยมเตือน)</li>
          <li>ระบบจะพามาที่หน้านี้</li>
        </ol>

        <ManualImg name="hr-warnings-01-overview.png" desc="ภาพรวมหน้าใบเตือน แสดงตัวกรอง การ์ดสรุป และรายการใบเตือน" />
      </Card>

      <Card>
        <CardTitle icon="🧩">ส่วนประกอบบนหน้าจอ (ใบเตือน)</CardTitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          <strong>หัวข้อหน้า</strong> ด้านบนแสดงชื่อ &ldquo;ใบเตือนทางวินัย&rdquo; พร้อมคำอธิบายว่า &ldquo;ออกและติดตามใบเตือน โดยพนักงาน ผู้จัดการ และฝ่ายบุคคลลงนามร่วมกัน&rdquo; มุมขวามีปุ่มสลับมุมมอง (แบบกะทัดรัด/แบบปกติ) และปุ่ม <strong>ออกใบเตือน</strong>
        </p>

        <CardSubtitle>ตัวกรอง 2 ช่อง</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>สาขา</strong> — เลือกกรองใบเตือนตามสาขา ค่าเริ่มต้นคือ &ldquo;ทุกสาขา&rdquo;</li>
          <li><strong>สถานะ</strong> — เลือกกรองตามสถานะ มีตัวเลือก: ทั้งหมด, มีผล, รับทราบแล้ว, ยกเลิก</li>
        </ul>

        <CardSubtitle>การ์ดสรุป (แสดงเมื่อมีใบเตือนอย่างน้อย 1 ใบ)</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">เป็นแถบตัวเลข 3 ช่อง โดยนับจากรายการที่กำลังแสดงอยู่ตามตัวกรองปัจจุบัน</p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>ทั้งหมด</strong> — จำนวนใบเตือนทั้งหมดที่แสดงอยู่</li>
          <li><strong>มีผล</strong> — จำนวนใบเตือนที่ยังมีผลอยู่ (สีเหลือง)</li>
          <li><strong>รับทราบแล้ว</strong> — จำนวนใบเตือนที่ลงนามครบทั้ง 3 ฝ่ายแล้ว (สีเขียว)</li>
        </ul>

        <CardSubtitle>รายการใบเตือน (การ์ด)</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          แต่ละใบเตือนเป็นการ์ดหนึ่งใบ แถบสีด้านข้างบอกสถานะ (เหลือง = มีผล, เขียว = รับทราบแล้ว, เทา = ยกเลิก) ในการ์ดจะแสดง
        </p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ชื่อพนักงาน พร้อมป้ายระดับโทษ</li>
          <li>ป้ายสถานะ: <strong>มีผล</strong> / <strong>รับทราบแล้ว</strong> / <strong>ยกเลิก</strong></li>
          <li>จำนวนเงิน (เฉพาะกรณีเลือกโทษแบบหักเป็นจำนวนเงิน)</li>
          <li><strong>ผลต่อ Service Charge</strong> — เช่น &ldquo;ไม่หัก Service Charge&rdquo;, &ldquo;25%&rdquo;, &ldquo;฿500&rdquo; ฯลฯ (ถ้าหักหลายงวดจะมี &ldquo;&times;2 งวด&rdquo; ต่อท้าย)</li>
          <li>เหตุผล และรายละเอียด (ถ้ามี)</li>
          <li>วันที่ออก และวันหมดอายุ (ถ้ามี)</li>
          <li><strong>ชิปลายมือชื่อ 3 ฝ่าย</strong> — พนักงาน / ผู้จัดการ / ฝ่ายบุคคล ฝ่ายที่ลงนามแล้วจะเป็นสีเขียวมีเครื่องหมายถูก (&#10003;) ฝ่ายที่ยังไม่ลงนามจะเป็นกรอบเส้นประมีวงกลม (&#9675;)</li>
        </ul>

        <CardSubtitle>ปุ่มในแต่ละการ์ด (แสดง/ซ่อนตามเงื่อนไข)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>ลงนาม (ผู้จัดการ)</strong> — แสดงเมื่อใบเตือนยังไม่ถูกยกเลิก และฝ่ายผู้จัดการยังไม่ได้ลงนาม</li>
          <li><strong>ลงนาม (ฝ่ายบุคคล)</strong> — แสดงเมื่อใบเตือนยังไม่ถูกยกเลิก และฝ่ายบุคคลยังไม่ได้ลงนาม</li>
          <li><strong>พิมพ์</strong> — แสดงเสมอ ใช้พิมพ์เอกสารใบเตือนใบนั้น</li>
          <li><strong>ยกเลิกใบเตือน</strong> — แสดงเมื่อใบเตือนยังไม่ถูกยกเลิก (ปุ่มสีแดง)</li>
        </ul>

        <CardSubtitle>ระดับโทษ (6 ระดับ) และผลต่อ Service Charge</CardSubtitle>
        <TableWrap>
          <thead>
            <tr><Th>ระดับโทษ</Th><Th>ผลต่อ Service Charge</Th></tr>
          </thead>
          <tbody>
            <tr><Td>ตักเตือนด้วยวาจา</Td><Td>ไม่หัก Service Charge</Td></tr>
            <tr><Td>หัก SC 25%</Td><Td>หัก Service Charge 25%</Td></tr>
            <tr><Td>หัก SC 50%</Td><Td>หัก Service Charge 50%</Td></tr>
            <tr><Td>หัก SC 100% (1 เดือน)</Td><Td>หัก Service Charge 1 เดือน</Td></tr>
            <tr><Td>หัก SC 200% (2 เดือน)</Td><Td>หัก Service Charge 2 เดือน</Td></tr>
            <tr><Td>หักเป็นจำนวนเงิน</Td><Td>ระบุจำนวนเงินเป็นบาทเอง</Td></tr>
          </tbody>
        </TableWrap>

        <CardSubtitle>สถานะใบเตือน</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>มีผล</strong> — เพิ่งออก ยังลงนามไม่ครบทั้ง 3 ฝ่าย</li>
          <li><strong>รับทราบแล้ว</strong> — ลงนามครบทั้งพนักงาน ผู้จัดการ และฝ่ายบุคคล ระบบจะเปลี่ยนสถานะให้อัตโนมัติ</li>
          <li><strong>ยกเลิก</strong> — ถูกยกเลิกไปแล้ว ไม่มีผลทางวินัยและรับลายมือชื่อเพิ่มไม่ได้</li>
        </ul>
      </Card>

      <Card>
        <CardTitle icon="🛠️">ขั้นตอนการทำงาน (ใบเตือน)</CardTitle>

        <CardSubtitle>ออกใบเตือนใหม่</CardSubtitle>
        <Step num={1} title="กดปุ่มออกใบเตือน">
          <p>กดปุ่ม &ldquo;ออกใบเตือน&rdquo; มุมขวาบน</p>
        </Step>
        <Step num={2} title="เลือกพนักงาน (จำเป็น)">
          <p>ในหน้าต่าง &ldquo;ออกใบเตือนทางวินัย&rdquo; เลือกพนักงานที่ต้องการออกใบเตือน</p>
        </Step>
        <Step num={3} title="เลือกสาขา">
          <p>ถ้าเป็นเรื่องเฉพาะสาขาให้เลือกสาขานั้น หรือเลือก &ldquo;ทั้งบริษัท (ไม่ระบุสาขา)&rdquo; (ช่องสาขาจะเลือกได้หลังเลือกพนักงานแล้ว และจะแสดงเฉพาะสาขาที่พนักงานคนนั้นสังกัด)</p>
        </Step>
        <Step num={4} title="เลือกระดับโทษ">
          <p>เลือกจาก 6 ระดับ ระบบจะแสดงผลต่อ Service Charge ให้เห็นข้างระดับโทษ ถ้าเลือก &ldquo;หักเป็นจำนวนเงิน&rdquo; ให้กรอกช่องจำนวนเงิน (บาท) ที่ต้องมากกว่า 0</p>
        </Step>
        <Step num={5} title="กรอกเหตุผลและแนบหลักฐาน">
          <p>กรอกเหตุผล (จำเป็น) และรายละเอียดเพิ่มเติม (ไม่บังคับ) แนบหลักฐานได้ (ไม่บังคับ) รองรับรูปภาพหรือ PDF ขนาดไม่เกิน 10MB</p>
        </Step>
        <Step num={6} title="กดบันทึก">
          <p>เมื่อสำเร็จจะขึ้นข้อความ &ldquo;ออกใบเตือนเรียบร้อย&rdquo; และใบเตือนใหม่จะปรากฏในรายการด้วยสถานะ &ldquo;มีผล&rdquo;</p>
        </Step>
        <ManualImg name="hr-warnings-02-issue-modal.png" desc="หน้าต่างออกใบเตือน แสดงช่องพนักงาน สาขา ระดับโทษ เหตุผล และแนบหลักฐาน" />

        <CardSubtitle>ลงนาม (ผู้จัดการ / ฝ่ายบุคคล)</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ในการ์ดใบเตือน กดปุ่ม <strong>ลงนาม (ผู้จัดการ)</strong> หรือ <strong>ลงนาม (ฝ่ายบุคคล)</strong> ตามบทบาทของคุณ</li>
          <li>ในหน้าต่าง &ldquo;ลงนามใบเตือน&rdquo; ให้เซ็นลายมือชื่อลงในกรอบด้วยเมาส์หรือนิ้ว (บนจอสัมผัส)</li>
          <li>ถ้าเซ็นผิดกดปุ่ม <strong>ล้าง</strong> เพื่อเริ่มใหม่</li>
          <li>กด <strong>บันทึก</strong> เมื่อสำเร็จจะขึ้น &ldquo;ลงนามเรียบร้อย&rdquo; และชิปฝ่ายนั้นจะเปลี่ยนเป็นสีเขียวมีเครื่องหมายถูก</li>
          <li>เมื่อลงนามครบทั้ง 3 ฝ่าย (พนักงาน ผู้จัดการ ฝ่ายบุคคล) สถานะจะเปลี่ยนเป็น &ldquo;รับทราบแล้ว&rdquo; อัตโนมัติ</li>
        </ol>
        <ManualImg name="hr-warnings-03-sign-modal.png" desc="หน้าต่างลงนามใบเตือน แสดงกรอบเซ็นลายมือชื่อ" />

        <CardSubtitle>ยกเลิกใบเตือน</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ในการ์ดใบเตือน กดปุ่ม <strong>ยกเลิกใบเตือน</strong> (ปุ่มสีแดง)</li>
          <li>ในหน้าต่าง &ldquo;ยกเลิกใบเตือน&rdquo; กรอกเหตุผลในการยกเลิก (จำเป็น)</li>
          <li>กดปุ่ม <strong>ยกเลิกใบเตือน</strong> เพื่อยืนยัน เมื่อสำเร็จจะขึ้น &ldquo;ยกเลิกใบเตือนเรียบร้อย&rdquo; สถานะเปลี่ยนเป็น &ldquo;ยกเลิก&rdquo; และจะรับลายมือชื่อเพิ่มไม่ได้อีก</li>
        </ol>
        <ManualImg name="hr-warnings-04-void-modal.png" desc="หน้าต่างยกเลิกใบเตือน แสดงช่องกรอกเหตุผลในการยกเลิก" />

        <CardSubtitle>พิมพ์ใบเตือน</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ในการ์ดใบเตือน กดปุ่ม <strong>พิมพ์</strong></li>
          <li>ระบบจะเตรียมเอกสาร &ldquo;หนังสือเตือนทางวินัย&rdquo; ที่มีข้อมูลพนักงาน ผู้ออก ระดับโทษ ผลต่อ Service Charge เหตุผล รายละเอียด และช่องลายมือชื่อทั้ง 3 ฝ่าย แล้วเปิดกล่องพิมพ์ของเบราว์เซอร์ให้พิมพ์หรือบันทึกเป็น PDF</li>
        </ol>
      </Card>

      <Card>
        <CardTitle icon="🔗">เชื่อมโยงกับหน้าอื่น (ใบเตือน)</CardTitle>
        <TableWrap>
          <thead>
            <tr><Th>หน้า</Th><Th>เส้นทาง</Th><Th>ความเชื่อมโยง</Th></tr>
          </thead>
          <tbody>
            <tr><Td>ใบเตือนของฉัน (ฝั่งพนักงาน)</Td><Td><code className="text-xs">/me/warnings</code></Td><Td>ใบเตือนที่ออกจากหน้านี้จะไปปรากฏให้พนักงานเห็น พนักงานลงนาม &ldquo;รับทราบ&rdquo; ได้จากหน้านั้น (ไม่ได้ทำจากหน้า HR)</Td></tr>
            <tr><Td>เมนูหลักฝ่ายบุคคล</Td><Td><code className="text-xs">/hr</code></Td><Td>ทางเข้าหน้านี้ ผ่านช่อง &ldquo;ใบเตือน&rdquo;</Td></tr>
            <tr><Td>เงินเดือน</Td><Td><code className="text-xs">/hr/payroll</code></Td><Td>ผลการหัก Service Charge ที่บันทึกในใบเตือนจะถูกนำไปคิดในรอบจ่ายเงินเดือน</Td></tr>
          </tbody>
        </TableWrap>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          <strong>การไหลของข้อมูล:</strong> HR/ผู้จัดการ ออกใบเตือน &rarr; ใบเตือนสถานะ &ldquo;มีผล&rdquo; ไปแสดงที่หน้าพนักงาน <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/me/warnings</code> &rarr; พนักงานลงนามรับทราบ, ผู้จัดการและฝ่ายบุคคลลงนามจากหน้านี้ &rarr; เมื่อครบ 3 ฝ่าย สถานะเปลี่ยนเป็น &ldquo;รับทราบแล้ว&rdquo; &rarr; ผลการหัก Service Charge นำไปคิดที่ <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/payroll</code>
        </p>

        <WarnBox>
          <ul className="ml-4 list-disc space-y-1.5">
            <li><strong>สิทธิ์การเข้าถึง</strong> — ผู้จัดการสาขาออก/ลงนามใบเตือนได้เฉพาะพนักงานในสาขาของตน (ระบบตรวจสอบว่าพนักงานคนนั้นสังกัดสาขาจริง) ส่วนการออกใบเตือน &ldquo;ทั้งบริษัท&rdquo; (ไม่ระบุสาขา) และการลงนามในช่อง &ldquo;ฝ่ายบุคคล&rdquo; ทำได้เฉพาะฝ่ายบุคคลระดับบริษัทเท่านั้น</li>
            <li><strong>การยกเลิก</strong> — ใบเตือนที่ผูกกับสาขา ยกเลิกได้โดยผู้จัดการสาขานั้นหรือฝ่ายบุคคล ส่วนใบเตือน &ldquo;ทั้งบริษัท&rdquo; ยกเลิกได้เฉพาะฝ่ายบุคคลระดับบริษัท</li>
            <li><strong>ต้องเป็นคนละคนกัน</strong> — ลายมือชื่อทั้ง 3 ฝ่ายต้องมาจาก 3 คนที่แตกต่างกัน คนเดียวลงนามซ้ำหลายบทบาทในใบเดียวกันไม่ได้ ระบบจะแจ้งเตือนหากบทบาทนั้นมีคนเซ็นแล้ว หรือหากคุณเคยลงนามใบนี้ไปแล้ว (&ldquo;บทบาทนี้ได้ลงนามแล้ว&rdquo;)</li>
            <li><strong>ระดับโทษกับ Service Charge</strong> — ผลการหัก Service Charge คำนวณจากระดับโทษที่เลือกโดยระบบเอง ไม่สามารถแก้ตัวเลขนอกเหนือจากที่ระดับกำหนด ยกเว้นแบบ &ldquo;หักเป็นจำนวนเงิน&rdquo; ที่ต้องกรอกจำนวนบาทเอง</li>
            <li><strong>เหตุผลจำเป็นเสมอ</strong> — ทั้งตอนออกใบเตือนและตอนยกเลิก ต้องกรอกเหตุผล มิฉะนั้นจะบันทึกไม่ได้</li>
            <li><strong>ใบเตือนที่ยกเลิกแล้ว</strong> — ปุ่มลงนามและปุ่มยกเลิกจะหายไป และรับลายมือชื่อเพิ่มไม่ได้</li>
            <li><strong>หลักฐาน</strong> — ต้องเป็นไฟล์ JPEG, PNG, WebP หรือ PDF ขนาดไม่เกิน 10MB มิฉะนั้นระบบจะปฏิเสธ (ระบบตรวจสอบชนิดไฟล์จริง ไม่ได้ดูแค่ชื่อไฟล์)</li>
            <li>หากออก/ลงนาม/ยกเลิกไม่สำเร็จ ระบบจะขึ้นข้อความแจ้ง เช่น &ldquo;ออกใบเตือนไม่สำเร็จ&rdquo;, &ldquo;ลงนามไม่สำเร็จ&rdquo; หรือ &ldquo;ยกเลิกใบเตือนไม่สำเร็จ&rdquo; ให้ตรวจสอบข้อมูลแล้วลองใหม่</li>
          </ul>
        </WarnBox>
      </Card>

      {/* ═══════════════ เบิกค่าใช้จ่าย ═══════════════ */}
      <Card>
        <CardTitle icon="🧾">เบิกค่าใช้จ่าย</CardTitle>
        <p className="mb-3 text-xs text-gray-400">
          เส้นทาง: <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/claims</code>
        </p>

        <CardSubtitle>หน้านี้ใช้ทำอะไร</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หน้านี้เป็นหน้าฝั่งแอดมิน/ผู้จัดการ สำหรับ &ldquo;ตรวจสอบและอนุมัติคำขอเบิกค่าใช้จ่ายของพนักงาน&rdquo; เมื่อพนักงานยื่นคำขอเบิกพร้อมแนบใบเสร็จเข้ามา (จากหน้าเบิกค่าใช้จ่ายฝั่งพนักงาน) รายการทั้งหมดจะมารวมรออนุมัติที่หน้านี้ ผู้จัดการสาขาหรือฝ่ายบุคคลจะเข้ามาดูรายละเอียด เปิดดูใบเสร็จ แล้วกด &ldquo;อนุมัติ&rdquo; หรือ &ldquo;ไม่อนุมัติ&rdquo; พร้อมระบุเหตุผลได้
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          บนหัวหน้าจอจะเขียนว่า &ldquo;อนุมัติการเบิกค่าใช้จ่าย&rdquo; และคำอธิบายว่า &ldquo;ตรวจสอบและอนุมัติคำขอเบิกของพนักงาน&rdquo; หน้านี้ยังมีการ์ดสรุปยอด และปุ่มพิมพ์รายงานสำหรับเก็บเป็นหลักฐาน
        </p>
        <ManualImg name="hr-claims-01-overview.png" desc="ภาพรวมหน้าอนุมัติการเบิกค่าใช้จ่าย" />

        <CardSubtitle>วิธีเข้าหน้านี้</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เข้าเมนูหลักของฝ่ายบุคคล ที่เส้นทาง <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr</code> (หน้าตารางเมนูแบบช่องสี่เหลี่ยม)</li>
          <li>กดที่ช่องเมนูชื่อ <strong>เบิกค่าใช้จ่าย</strong></li>
          <li>ระบบจะเปิดหน้านี้ขึ้นมา โดยค่าเริ่มต้นจะกรองแสดงเฉพาะรายการที่ยัง &ldquo;รออนุมัติ&rdquo;</li>
        </ol>
      </Card>

      <Card>
        <CardTitle icon="🧩">ส่วนประกอบบนหน้าจอ (เบิกค่าใช้จ่าย)</CardTitle>

        <CardSubtitle>ส่วนหัว (ด้านบน)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>ชื่อหน้า</strong>: &ldquo;อนุมัติการเบิกค่าใช้จ่าย&rdquo; พร้อมคำอธิบายใต้ชื่อ</li>
          <li><strong>ปุ่มสลับมุมมอง</strong>: สลับการแสดงรายการระหว่างแบบปกติกับแบบกระชับ (compact) เพื่อให้เห็นได้หลายรายการต่อหน้าจอ ไม่มีผลต่อข้อมูล เป็นแค่การแสดงผล</li>
          <li><strong>ปุ่ม พิมพ์</strong>: กดเพื่อสั่งพิมพ์รายงานรายการเบิก (ดูหัวข้อขั้นตอนการทำงาน)</li>
        </ul>

        <CardSubtitle>ตัวกรอง (2 ช่องเลือก วางเรียงกัน)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>สาขา</strong>: เลือกกรองเฉพาะสาขาที่ต้องการ ค่าเริ่มต้นคือ &ldquo;ทุกสาขา&rdquo; (รายการสาขาในช่องนี้จะแสดงเฉพาะสาขาที่คุณมีสิทธิ์ดูแลเท่านั้น)</li>
          <li><strong>สถานะ</strong>: เลือกกรองตามสถานะของคำขอ มีตัวเลือก ทั้งหมด / รออนุมัติ / อนุมัติแล้ว / ไม่อนุมัติ / จ่ายแล้ว / ยกเลิกแล้ว ค่าเริ่มต้นคือ &ldquo;รออนุมัติ&rdquo;</li>
        </ul>

        <CardSubtitle>การ์ดสรุปยอด (แสดงเมื่อมีรายการเท่านั้น มี 3 ช่อง)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>ทั้งหมด</strong>: จำนวนคำขอทั้งหมดตามตัวกรองปัจจุบัน</li>
          <li><strong>รออนุมัติ</strong>: จำนวนรายการที่ยังรออนุมัติ</li>
          <li><strong>จำนวนเงิน</strong>: ยอดเงินรวมของทุกรายการที่แสดงอยู่ (หน่วยบาท)</li>
        </ul>

        <CardSubtitle>รายการคำขอ (การ์ดทีละใบ)</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">แต่ละใบแสดง:</p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>ชื่อผู้เบิก</strong> (พนักงานที่ยื่นคำขอ)</li>
          <li><strong>ประเภทค่าใช้จ่าย</strong>: ค่าเดินทาง / ค่ารักษาพยาบาล / ค่าวัสดุสิ้นเปลือง / ค่าอุปกรณ์ / อื่น ๆ</li>
          <li>
            <strong>ป้ายสถานะ</strong> มีค่าและสีดังนี้:
            <ul className="ml-4 mt-1 list-disc space-y-1">
              <li><strong>รออนุมัติ</strong> (สีเหลือง) — ยังไม่ตัดสิน</li>
              <li><strong>อนุมัติแล้ว</strong> (สีเขียว)</li>
              <li><strong>ไม่อนุมัติ</strong> (สีแดง)</li>
              <li><strong>จ่ายแล้ว</strong> (สีเขียว) — เบิกผ่านและจ่ายเงินเรียบร้อย</li>
              <li><strong>ยกเลิกแล้ว</strong> (สีเทา) — พนักงานยกเลิกคำขอเอง</li>
            </ul>
          </li>
          <li><strong>จำนวนเงิน</strong> ที่ขอเบิก</li>
          <li><strong>วันที่ใช้จ่าย</strong> และ <strong>รายละเอียด</strong> ที่พนักงานกรอก</li>
          <li><strong>ปุ่ม ดูใบเสร็จ</strong>: แสดงเฉพาะเมื่อคำขอนั้นแนบไฟล์ใบเสร็จมา กดเพื่อเปิดไฟล์ใบเสร็จในแท็บใหม่</li>
          <li><strong>เหตุผล / หมายเหตุ</strong>: ถ้ามีการตัดสินไปแล้วและระบุหมายเหตุไว้ จะแสดงข้อความนั้นด้านล่าง</li>
          <li><strong>ปุ่มตัดสิน</strong>: ปุ่ม <strong>อนุมัติ</strong> และ <strong>ไม่อนุมัติ</strong> จะปรากฏ <strong>เฉพาะรายการที่สถานะเป็น &ldquo;รออนุมัติ&rdquo; เท่านั้น</strong> รายการที่ตัดสินหรือยกเลิกไปแล้วจะไม่มีปุ่มนี้</li>
        </ul>
        <ManualImg name="hr-claims-02-pending-card.png" desc="การ์ดคำขอเบิกที่รออนุมัติพร้อมปุ่มอนุมัติและไม่อนุมัติ" />
      </Card>

      <Card>
        <CardTitle icon="🛠️">ขั้นตอนการทำงาน (เบิกค่าใช้จ่าย)</CardTitle>

        <CardSubtitle>ก. อนุมัติคำขอ</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เลือกตัวกรอง &ldquo;สถานะ&rdquo; เป็น &ldquo;รออนุมัติ&rdquo; (เป็นค่าเริ่มต้นอยู่แล้ว)</li>
          <li>หาการ์ดของพนักงานที่ต้องการ ตรวจดูจำนวนเงิน วันที่ และรายละเอียด</li>
          <li>ถ้ามีใบเสร็จ ให้กด <strong>ดูใบเสร็จ</strong> เพื่อเปิดไฟล์ตรวจสอบก่อน</li>
          <li>กดปุ่ม <strong>อนุมัติ</strong></li>
          <li>ระบบจะแจ้งเตือน &ldquo;อนุมัติแล้ว&rdquo; และสถานะของรายการจะเปลี่ยนเป็น &ldquo;อนุมัติแล้ว&rdquo; (เมื่อกรองด้วย &ldquo;รออนุมัติ&rdquo; รายการนี้จะหายจากรายการเพราะไม่รออนุมัติแล้ว ต้องเปลี่ยนตัวกรองเป็น &ldquo;อนุมัติแล้ว&rdquo; หรือ &ldquo;ทั้งหมด&rdquo; จึงจะเห็นอีกครั้ง)</li>
        </ol>

        <CardSubtitle>ข. ไม่อนุมัติคำขอ (พร้อมเหตุผล)</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ที่การ์ดที่รออนุมัติ กดปุ่ม <strong>ไม่อนุมัติ</strong></li>
          <li>ปุ่มจะเปลี่ยนเป็นช่องกรอกข้อความ &ldquo;เหตุผล / หมายเหตุ&rdquo; พร้อมปุ่ม <strong>ไม่อนุมัติ</strong> (ยืนยัน) และปุ่ม <strong>ยกเลิก</strong></li>
          <li>พิมพ์เหตุผลลงในช่อง (ไม่บังคับ แต่แนะนำให้ระบุ) แล้วกด <strong>ไม่อนุมัติ</strong> เพื่อยืนยัน</li>
          <li>ถ้าเปลี่ยนใจ กด <strong>ยกเลิก</strong> เพื่อปิดช่องกรอกโดยไม่ตัดสิน</li>
          <li>เมื่อยืนยัน ระบบแจ้ง &ldquo;ไม่อนุมัติแล้ว&rdquo; สถานะเปลี่ยนเป็น &ldquo;ไม่อนุมัติ&rdquo; และเหตุผลที่กรอกจะไปแสดงเป็นหมายเหตุใต้การ์ด</li>
        </ol>
        <ManualImg name="hr-claims-03-reject-note.png" desc="ช่องกรอกเหตุผลตอนกดไม่อนุมัติ" />

        <CardSubtitle>ค. ดูใบเสร็จ</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดปุ่ม <strong>ดูใบเสร็จ</strong> ที่การ์ด</li>
          <li>ระบบจะเปิดไฟล์ใบเสร็จ (รูปภาพหรือ PDF) ขึ้นในแท็บใหม่ ระหว่างโหลดจะมีสัญลักษณ์หมุนอยู่ที่ปุ่ม</li>
          <li>ถ้าเปิดไม่ได้ ระบบจะแจ้ง &ldquo;เปิดใบเสร็จไม่สำเร็จ&rdquo;</li>
        </ol>

        <CardSubtitle>ง. พิมพ์รายงาน</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดปุ่ม <strong>พิมพ์</strong> ด้านบน</li>
          <li>ระบบจะเตรียมหน้าพิมพ์เป็นตารางสรุปหัวข้อ &ldquo;รายการเบิกค่าใช้จ่าย&rdquo; โดยมีคอลัมน์: ผู้เบิก / ประเภท / จำนวนเงิน / วันที่ / รายละเอียด / สถานะ</li>
          <li>รายการที่พิมพ์คือรายการตามตัวกรองที่เลือกอยู่ตอนนั้น จากนั้นเลือกเครื่องพิมพ์หรือบันทึกเป็น PDF ได้ตามปกติ</li>
        </ol>
      </Card>

      <Card>
        <CardTitle icon="🔗">เชื่อมโยงกับหน้าอื่น (เบิกค่าใช้จ่าย)</CardTitle>
        <TableWrap>
          <thead>
            <tr><Th>หน้า</Th><Th>เส้นทาง</Th><Th>ข้อมูลไหลอย่างไร</Th></tr>
          </thead>
          <tbody>
            <tr><Td>เบิกค่าใช้จ่าย (ฝั่งพนักงาน)</Td><Td><code className="text-xs">/me/claims</code></Td><Td>พนักงานยื่นคำขอเบิกพร้อมแนบใบเสร็จที่นี่ แล้วคำขอจะมารออนุมัติที่ <code className="text-xs">/hr/claims</code></Td></tr>
            <tr><Td>เมนูฝ่ายบุคคล</Td><Td><code className="text-xs">/hr</code></Td><Td>ทางเข้าหลักของหน้านี้ (กดช่อง &ldquo;เบิกค่าใช้จ่าย&rdquo;)</Td></tr>
            <tr><Td>เงินเดือน</Td><Td><code className="text-xs">/hr/payroll</code></Td><Td>คำขอที่ &ldquo;อนุมัติแล้ว&rdquo; จะถูกนำไปเป็นรายการเงินได้ในสลิปเงินเดือนในรอบจ่ายถัดไป (หน้านี้เพียงบันทึกผลอนุมัติ ยังไม่จ่ายเงินทันที)</Td></tr>
            <tr><Td>แดชบอร์ดวันนี้</Td><Td><code className="text-xs">/hr/today</code></Td><Td>สรุปภาพรวมงานฝ่ายบุคคลรวมถึงรายการที่รอดำเนินการ</Td></tr>
          </tbody>
        </TableWrap>

        <WarnBox>
          <ul className="ml-4 list-disc space-y-1.5">
            <li><strong>สิทธิ์การเข้าถึง</strong>: ระบบตัดสินสิทธิ์จากสาขาของคำขอ — คำขอที่ผูกกับสาขาต้องเป็น &ldquo;ผู้จัดการสาขานั้น&rdquo; จึงอนุมัติ/ไม่อนุมัติได้ ส่วนคำขอที่ไม่ผูกสาขาต้องเป็นฝ่ายบุคคล และช่องเลือกสาขาจะแสดงเฉพาะสาขาที่คุณมีสิทธิ์ดูแลเท่านั้น</li>
            <li><strong>ตัดสินได้เฉพาะที่รออนุมัติ</strong>: อนุมัติหรือไม่อนุมัติได้เฉพาะรายการสถานะ &ldquo;รออนุมัติ&rdquo; หากรายการถูกตัดสินหรือถูกพนักงานยกเลิกไปก่อนหน้า (เช่นคนอื่นเพิ่งกดอนุมัติพร้อมกัน) ระบบจะแจ้ง &ldquo;ดำเนินการไม่สำเร็จ&rdquo; และไม่มีการเปลี่ยนแปลงซ้ำซ้อน</li>
            <li><strong>หมายเหตุยาวได้จำกัด</strong>: ข้อความเหตุผล/หมายเหตุจะถูกเก็บสูงสุด 300 ตัวอักษร (ส่วนเกินจะถูกตัดออก)</li>
            <li><strong>การอนุมัติไม่ใช่การจ่ายเงิน</strong>: การกดอนุมัติเป็นเพียงการบันทึกผลการตัดสิน ตัวเงินจริงจะไปคำนวณในสลิปเงินเดือนของรอบถัดไป</li>
            <li><strong>ทุกการตัดสินถูกบันทึกประวัติ</strong>: ระบบเก็บบันทึกว่าใครอนุมัติ/ไม่อนุมัติ เมื่อไร และด้วยเหตุผลใด เพื่อการตรวจสอบย้อนหลัง</li>
            <li>หากโหลดข้อมูลหรือดำเนินการไม่ได้ ระบบจะแสดงข้อความแจ้งเตือน และหากไม่มีรายการตรงตามตัวกรองจะขึ้นข้อความ &ldquo;ยังไม่มีรายการเบิก&rdquo;</li>
          </ul>
        </WarnBox>
      </Card>

      {/* ═══════════════ คำขอแก้ไขข้อมูล ═══════════════ */}
      <Card>
        <CardTitle icon="✏️">คำขอแก้ไขข้อมูล</CardTitle>
        <p className="mb-3 text-xs text-gray-400">
          เส้นทาง: <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/profile-requests</code>
        </p>

        <CardSubtitle>หน้านี้ใช้ทำอะไร</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หน้านี้คือ &ldquo;คิวอนุมัติ&rdquo; สำหรับฝ่ายบุคคล (HR) โดยเฉพาะ ใช้ตรวจสอบและตัดสินใจกับคำขอแก้ไขข้อมูลส่วนตัวที่พนักงานส่งเข้ามาเอง ซึ่งมี 2 ประเภทคือ <strong>บัญชีธนาคาร</strong> และ <strong>ผู้ติดต่อฉุกเฉิน</strong> พนักงานไม่สามารถแก้ไขข้อมูลสองอย่างนี้เองได้โดยตรง ต้องส่งเป็นคำขอเข้ามาให้ HR อนุมัติก่อนเสมอ เพราะเป็นข้อมูลสำคัญ (โดยเฉพาะเลขบัญชีธนาคารที่ใช้โอนเงินเดือน)
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          เมื่อ HR กด &ldquo;อนุมัติ&rdquo; ระบบจะนำค่าใหม่ไปเขียนทับข้อมูลในประวัติพนักงานให้อัตโนมัติทันที ทำให้ข้อมูลที่ใช้จ่ายเงินเดือนและติดต่อฉุกเฉินถูกอัปเดตตาม ส่วนการ &ldquo;ปฏิเสธ&rdquo; จะไม่แตะข้อมูลพนักงานเดิม เพียงปิดคำขอนั้นพร้อมบันทึกหมายเหตุเหตุผลไว้
        </p>

        <CardSubtitle>วิธีเข้าหน้านี้</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เข้าจากเมนูหลักของฝ่ายบุคคล หน้า <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr</code> แล้วกดไทล์ (การ์ดเมนู) ชื่อ <strong>&ldquo;คำขอแก้ไขข้อมูล&rdquo;</strong></li>
          <li>หรือเข้าจากหน้าแดชบอร์ด HR (<code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/dashboard</code>) โดยกดที่การ์ดสรุปจำนวนคำขอแก้ไขข้อมูลที่รออนุมัติ ระบบจะพามาที่หน้านี้โดยตรง</li>
        </ul>
        <TipBox>
          หน้านี้เปิดให้เฉพาะผู้ที่มีสิทธิ์จัดการงานบุคคลระดับบริษัทเท่านั้น ผู้จัดการร้าน (คนคุมร้าน) จะไม่เห็นและเข้าไม่ได้ เพราะคำขอเหล่านี้มีข้อมูลบัญชีธนาคารที่ต้องปกป้องเป็นพิเศษ
        </TipBox>
        <ManualImg name="hr-profile-requests-01-overview.png" desc="ภาพรวมหน้าคำขอแก้ไขข้อมูล พร้อมตัวกรองสถานะและรายการคำขอ" />
      </Card>

      <Card>
        <CardTitle icon="🧩">ส่วนประกอบบนหน้าจอ (คำขอแก้ไขข้อมูล)</CardTitle>

        <CardSubtitle>1. หัวข้อหน้า</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ชื่อหน้า: <strong>&ldquo;คำขอแก้ไขข้อมูลพนักงาน&rdquo;</strong></li>
          <li>คำอธิบายใต้ชื่อ: <strong>&ldquo;ตรวจสอบและอนุมัติคำขอแก้ไขบัญชีธนาคารและผู้ติดต่อฉุกเฉิน&rdquo;</strong></li>
          <li>มุมขวาบนมีปุ่มสลับมุมมองรายการ (ไอคอนสลับ) สำหรับเลือกดูแบบปกติหรือแบบกระชับ (แสดงข้อมูลถี่ขึ้น) เป็นการปรับการแสดงผลเท่านั้น ไม่กระทบข้อมูล</li>
        </ul>

        <CardSubtitle>2. ตัวกรองสถานะ (ช่อง &ldquo;สถานะ&rdquo;)</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          เป็นเมนูแบบเลื่อนลง (dropdown) สำหรับเลือกดูคำขอตามสถานะ ค่าเริ่มต้นเมื่อเปิดหน้าคือ <strong>&ldquo;รอดำเนินการ&rdquo;</strong> เพื่อให้เห็นงานที่ต้องทำก่อน ตัวเลือกทั้งหมดมี:
        </p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>รอดำเนินการ</strong> — คำขอที่ยังไม่ได้ตัดสินใจ (งานที่รอ HR จัดการ)</li>
          <li><strong>อนุมัติแล้ว</strong> — คำขอที่อนุมัติไปแล้ว</li>
          <li><strong>ปฏิเสธแล้ว</strong> — คำขอที่ปฏิเสธไปแล้ว</li>
          <li><strong>ยกเลิกแล้ว</strong> — คำขอที่พนักงานยกเลิกเองก่อน HR ตัดสินใจ</li>
          <li><strong>ทั้งหมด</strong> — แสดงทุกสถานะรวมกัน</li>
        </ul>

        <CardSubtitle>3. รายการคำขอ (การ์ดแต่ละใบ)</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">แต่ละคำขอแสดงเป็นการ์ด 1 ใบ เรียงจากใหม่สุดไปเก่าสุด ในการ์ดประกอบด้วย:</p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>ชื่อพนักงานผู้ขอ</strong> (แสดงเป็นหัวข้อการ์ด)</li>
          <li><strong>ประเภทข้อมูลที่ขอแก้</strong> ใต้ชื่อ เป็นได้ 2 ค่า: <strong>&ldquo;บัญชีธนาคาร&rdquo;</strong> หรือ <strong>&ldquo;ผู้ติดต่อฉุกเฉิน&rdquo;</strong></li>
          <li>
            <strong>ป้ายสถานะ (badge)</strong> มุมการ์ด บอกสถานะปัจจุบันด้วยสีต่างกัน:
            <ul className="ml-4 mt-1 list-disc space-y-1">
              <li><strong>รอดำเนินการ</strong> (สีเหลือง/เตือน)</li>
              <li><strong>อนุมัติแล้ว</strong> (สีเขียว)</li>
              <li><strong>ปฏิเสธแล้ว</strong> (สีแดง)</li>
              <li><strong>ยกเลิกแล้ว</strong> (สีเทา)</li>
            </ul>
          </li>
          <li>
            <strong>ตารางเปรียบเทียบข้อมูล</strong> แบ่ง 2 ช่องข้างกัน:
            <ul className="ml-4 mt-1 list-disc space-y-1">
              <li>ช่องซ้าย <strong>&ldquo;ข้อมูลปัจจุบัน&rdquo;</strong> = ค่าเดิมที่มีอยู่ในระบบ</li>
              <li>ช่องขวา <strong>&ldquo;ข้อมูลใหม่&rdquo;</strong> = ค่าที่พนักงานขอเปลี่ยนเป็น</li>
              <li>รายการย่อยจะใช้ชื่อภาษาไทยตามประเภท เช่น บัญชีธนาคารจะเห็น <strong>ธนาคาร / เลขที่บัญชี / ชื่อบัญชี</strong> ส่วนผู้ติดต่อฉุกเฉินจะเห็น <strong>ชื่อ / เบอร์โทรศัพท์ / ความสัมพันธ์</strong> ถ้าช่องไหนไม่มีค่าจะแสดงเป็นขีด (&mdash;)</li>
            </ul>
          </li>
          <li><strong>เหตุผล</strong> — ถ้าพนักงานระบุเหตุผลมาด้วย จะแสดงบรรทัด &ldquo;เหตุผล: ...&rdquo; (ถ้าไม่ได้ระบุจะไม่แสดง)</li>
          <li><strong>หมายเหตุการพิจารณา</strong> — ถ้าคำขอนั้นตัดสินใจไปแล้วและมี HR ใส่หมายเหตุไว้ จะแสดงบรรทัด &ldquo;หมายเหตุการพิจารณา: ...&rdquo;</li>
        </ul>

        <CardSubtitle>4. ปุ่มบนการ์ด (แสดงเฉพาะคำขอที่ &ldquo;รอดำเนินการ&rdquo;)</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          ปุ่มจะปรากฏก็ต่อเมื่อคำขอนั้นยังอยู่สถานะ &ldquo;รอดำเนินการ&rdquo; เท่านั้น คำขอที่อนุมัติ/ปฏิเสธ/ยกเลิกไปแล้วจะไม่มีปุ่มให้กด
        </p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ปุ่ม <strong>&ldquo;ปฏิเสธ&rdquo;</strong> (ปุ่มขอบเส้น)</li>
          <li>ปุ่ม <strong>&ldquo;อนุมัติ&rdquo;</strong> (ปุ่มทึบ)</li>
        </ul>

        <CardSubtitle>5. กรณีไม่มีคำขอ</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          ถ้าไม่มีคำขอในสถานะที่เลือก จะแสดงกล่องว่างพร้อมข้อความ <strong>&ldquo;ยังไม่มีคำขอแก้ไข&rdquo;</strong>
        </p>
      </Card>

      <Card>
        <CardTitle icon="🛠️">ขั้นตอนการทำงาน (คำขอแก้ไขข้อมูล)</CardTitle>

        <CardSubtitle>อนุมัติคำขอ</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เลือกตัวกรองสถานะเป็น <strong>&ldquo;รอดำเนินการ&rdquo;</strong> (ค่าเริ่มต้น)</li>
          <li>อ่านการ์ดคำขอ เปรียบเทียบช่อง &ldquo;ข้อมูลปัจจุบัน&rdquo; กับ &ldquo;ข้อมูลใหม่&rdquo; และดูเหตุผลที่พนักงานแจ้ง</li>
          <li>กดปุ่ม <strong>&ldquo;อนุมัติ&rdquo;</strong></li>
          <li>ระบบจะแจ้งเตือนสีเขียว <strong>&ldquo;อนุมัติคำขอแล้ว&rdquo;</strong> และนำค่าใหม่ไปอัปเดตประวัติพนักงานทันที คำขอจะย้ายไปอยู่สถานะ &ldquo;อนุมัติแล้ว&rdquo; (หายจากรายการ &ldquo;รอดำเนินการ&rdquo;)</li>
          <li>ในบางกรณีที่ระบบอนุมัติสำเร็จแต่ไม่สามารถเขียนข้อมูลลงประวัติพนักงานได้อัตโนมัติ จะขึ้นแจ้งเตือนสีเหลือง <strong>&ldquo;อนุมัติแล้ว แต่ไม่สามารถอัปเดตข้อมูลพนักงานอัตโนมัติได้ กรุณาตรวจสอบด้วยตนเอง&rdquo;</strong> กรณีนี้ให้ HR ไปแก้ไขข้อมูลในประวัติพนักงานเองตามค่าใหม่</li>
        </ol>
        <ManualImg name="hr-profile-requests-02-pending-card.png" desc="การ์ดคำขอที่รอดำเนินการ พร้อมปุ่มอนุมัติและปฏิเสธ และตารางเปรียบเทียบข้อมูล" />

        <CardSubtitle>ปฏิเสธคำขอ</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ที่การ์ดคำขอที่ &ldquo;รอดำเนินการ&rdquo; กดปุ่ม <strong>&ldquo;ปฏิเสธ&rdquo;</strong></li>
          <li>ปุ่มบนการ์ดจะเปลี่ยนเป็นช่องกรอกข้อความ <strong>&ldquo;หมายเหตุการพิจารณา&rdquo;</strong> พร้อมปุ่ม &ldquo;ปฏิเสธ&rdquo; (สีแดง) และปุ่ม &ldquo;ยกเลิก&rdquo;</li>
          <li>(แนะนำ) พิมพ์เหตุผลที่ปฏิเสธลงในช่องหมายเหตุ เพื่อให้มีบันทึกอ้างอิง — ช่องนี้ไม่บังคับ จะเว้นว่างก็ได้</li>
          <li>กดปุ่ม <strong>&ldquo;ปฏิเสธ&rdquo;</strong> สีแดงเพื่อยืนยัน หรือกด <strong>&ldquo;ยกเลิก&rdquo;</strong> เพื่อกลับไปโดยไม่ปฏิเสธ</li>
          <li>เมื่อยืนยัน ระบบจะแจ้งเตือน <strong>&ldquo;ปฏิเสธคำขอแล้ว&rdquo;</strong> คำขอจะย้ายไปสถานะ &ldquo;ปฏิเสธแล้ว&rdquo; โดยไม่มีการเปลี่ยนแปลงข้อมูลพนักงานเดิม หมายเหตุที่ใส่จะแสดงเป็นบรรทัด &ldquo;หมายเหตุการพิจารณา&rdquo; บนการ์ด</li>
        </ol>
        <ManualImg name="hr-profile-requests-03-reject-note.png" desc="การกดปฏิเสธจะเปิดช่องกรอกหมายเหตุการพิจารณา พร้อมปุ่มยืนยันปฏิเสธและยกเลิก" />

        <CardSubtitle>ดูประวัติคำขอที่ตัดสินใจไปแล้ว</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          เปลี่ยนตัวกรองสถานะเป็น &ldquo;อนุมัติแล้ว&rdquo; / &ldquo;ปฏิเสธแล้ว&rdquo; / &ldquo;ยกเลิกแล้ว&rdquo; หรือ &ldquo;ทั้งหมด&rdquo; เพื่อย้อนดูคำขอเก่า การ์ดในสถานะเหล่านี้จะไม่มีปุ่มให้ตัดสินใจแล้ว ใช้ดูอย่างเดียว
        </p>
      </Card>

      <Card>
        <CardTitle icon="🔗">เชื่อมโยงกับหน้าอื่น (คำขอแก้ไขข้อมูล)</CardTitle>
        <TableWrap>
          <thead>
            <tr><Th>หน้า/เมนู</Th><Th>เส้นทาง</Th><Th>ความเชื่อมโยง</Th></tr>
          </thead>
          <tbody>
            <tr><Td>หน้าหลักฝ่ายบุคคล</Td><Td><code className="text-xs">/hr</code></Td><Td>เป็นทางเข้าหลัก มีไทล์ &ldquo;คำขอแก้ไขข้อมูล&rdquo; พามาที่หน้านี้</Td></tr>
            <tr><Td>แดชบอร์ด HR</Td><Td><code className="text-xs">/hr/dashboard</code></Td><Td>แสดงจำนวนคำขอแก้ไขข้อมูลที่รออนุมัติ กดที่การ์ดเพื่อมาที่หน้านี้</Td></tr>
            <tr><Td>โปรไฟล์ของฉัน (ฝั่งพนักงาน)</Td><Td><code className="text-xs">/me/profile</code></Td><Td>เป็นต้นทางที่พนักงานกด &ldquo;ขอแก้ไข&rdquo; บัญชีธนาคารหรือผู้ติดต่อฉุกเฉิน คำขอที่ส่งจากที่นี่จะมาโผล่รออนุมัติในหน้านี้ และเมื่อ HR อนุมัติ ข้อมูลใหม่จะกลับไปแสดงในโปรไฟล์ของพนักงานคนนั้น</Td></tr>
            <tr><Td>ข้อมูลพนักงาน (ประวัติพนักงาน)</Td><Td>ระบบข้อมูลพนักงานของ HR</Td><Td>ปลายทางของการอนุมัติ — ค่าบัญชีธนาคาร/ผู้ติดต่อฉุกเฉินที่อนุมัติจะถูกเขียนทับลงประวัติพนักงาน และถูกนำไปใช้ต่อในการจ่ายเงินเดือน</Td></tr>
          </tbody>
        </TableWrap>

        <WarnBox>
          <ul className="ml-4 list-disc space-y-1.5">
            <li><strong>สิทธิ์การเข้าถึง:</strong> เฉพาะ HR ระดับบริษัทเท่านั้น ผู้จัดการร้านเข้าไม่ได้ เพราะมีข้อมูลบัญชีธนาคาร</li>
            <li><strong>ตัดสินใจได้ครั้งเดียว:</strong> คำขอ 1 ใบ อนุมัติหรือปฏิเสธได้เพียงครั้งเดียว หากคุณและเพื่อนร่วมงานเปิดหน้าเดียวกันแล้วกดพร้อมกัน คนที่กดทีหลังจะไม่มีผล (คำขอถูกตัดสินใจไปก่อนแล้ว) และจะขึ้นแจ้งเตือน <strong>&ldquo;ดำเนินการไม่สำเร็จ&rdquo;</strong> ให้รีเฟรชหน้าหรือเปลี่ยนตัวกรองสถานะเพื่อดูสถานะล่าสุด</li>
            <li><strong>การอนุมัติมีผลทันทีต่อข้อมูลจริง:</strong> เมื่ออนุมัติบัญชีธนาคาร ระบบจะนำเลขบัญชีใหม่ไปใช้กับเงินเดือน จึงควรตรวจความถูกต้องของเลขที่บัญชีและชื่อบัญชีให้ดีก่อนกดอนุมัติ</li>
            <li><strong>กรณีขึ้นแจ้งเตือนสีเหลือง (อัปเดตอัตโนมัติไม่สำเร็จ):</strong> แปลว่าคำขอถูกอนุมัติแล้วจริง แต่ระบบเขียนลงประวัติพนักงานไม่สำเร็จ (เช่น หาบัญชีพนักงานที่ผูกกันไม่เจอ) HR ต้องเข้าไปแก้ค่าในประวัติพนักงานด้วยตนเอง</li>
            <li><strong>ถ้าโหลดข้อมูลไม่สำเร็จ:</strong> รายการจะว่างเปล่า ให้ลองเปลี่ยนตัวกรองสถานะหรือรีเฟรชหน้าใหม่</li>
            <li>หากพนักงานยกเลิกคำขอเองก่อน HR ตัดสินใจ คำขอจะไปอยู่สถานะ &ldquo;ยกเลิกแล้ว&rdquo; และไม่ต้องดำเนินการใด ๆ</li>
          </ul>
        </WarnBox>
      </Card>

      {/* ═══════════════ การพ้นสภาพ ═══════════════ */}
      <Card>
        <CardTitle icon="🚪">การพ้นสภาพ</CardTitle>
        <p className="mb-3 text-xs text-gray-400">
          เส้นทาง: <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/offboarding</code>
        </p>

        <CardSubtitle>หน้านี้ใช้ทำอะไร</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หน้า &ldquo;การพ้นสภาพพนักงาน&rdquo; ใช้สำหรับให้ฝ่ายบุคคลเริ่มและติดตามกระบวนการเมื่อพนักงาน &ldquo;ลาออก&rdquo; หรือถูก &ldquo;เลิกจ้าง&rdquo; ตั้งแต่ต้นจนจบในที่เดียว โดยครอบคลุมการบันทึกเหตุผล วันที่แจ้ง วันทำงานสุดท้าย หมายเหตุค่าชดเชย ไปจนถึงการจัดการ &ldquo;รายการคืนทรัพย์สิน&rdquo; ที่พนักงานถืออยู่ (เช่น เครื่องมือ อุปกรณ์) และการลงนามรับรองของทั้งพนักงานและฝ่ายบุคคล
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          เมื่อทำรายการจนถึงขั้น &ldquo;เสร็จสิ้น&rdquo; ระบบจะปิดสถานะการจ้างงานของพนักงานคนนั้นให้อัตโนมัติ ได้แก่ เปลี่ยนสถานะพนักงานเป็นลาออก/เลิกจ้าง บันทึกวันสิ้นสุดการทำงาน ปรับสถานะทรัพย์สินตามที่ระบุ (คืนแล้ว/สูญหาย/ชำรุด) และปิดการใช้งานบัญชีเข้าระบบของพนักงาน จึงเป็นหน้าที่ต้องทำอย่างรอบคอบเพราะมีผลกับข้อมูลจริงหลายส่วน
        </p>

        <CardSubtitle>วิธีเข้าหน้านี้</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เข้าเมนูหลักของฝ่ายบุคคลที่หน้า <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr</code> (หน้ารวมเมนู HR แบบตารางไอคอน)</li>
          <li>กดช่อง &ldquo;การพ้นสภาพ&rdquo;</li>
          <li>ระบบจะพาเข้าสู่หน้า <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/offboarding</code></li>
        </ol>
        <ManualImg name="hr-offboarding-01-overview.png" desc="ภาพรวมหน้าการพ้นสภาพ แสดงหัวข้อ ตัวกรองสถานะ และรายการการ์ด" />
      </Card>

      <Card>
        <CardTitle icon="🧩">ส่วนประกอบบนหน้าจอ (การพ้นสภาพ)</CardTitle>

        <CardSubtitle>แถบหัวเรื่องด้านบน</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ชื่อหน้า: &ldquo;การพ้นสภาพพนักงาน&rdquo; พร้อมคำอธิบาย &ldquo;เริ่มและติดตามการลาออก/เลิกจ้างและการคืนทรัพย์สิน&rdquo;</li>
          <li>ปุ่มสลับมุมมอง (ไอคอนสองแบบ) สำหรับสลับการแสดงรายการระหว่างแบบปกติกับแบบกระชับ</li>
          <li>ปุ่ม &ldquo;เริ่มการพ้นสภาพ&rdquo; (ปุ่มมีเครื่องหมายบวก) สำหรับสร้างรายการใหม่</li>
        </ul>

        <CardSubtitle>ตัวกรอง</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          ช่อง &ldquo;สถานะ&rdquo; เป็นตัวเลือกแบบดึงลง เลือกกรองรายการตามสถานะ มีตัวเลือก: ทั้งหมด, ร่าง, รอลงนาม, เสร็จสิ้น, ยกเลิก เมื่อเลือกแล้วรายการด้านล่างจะกรองให้ทันที
        </p>

        <CardSubtitle>รายการการพ้นสภาพ (การ์ด)</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">แต่ละการ์ดหนึ่งใบคือพนักงานหนึ่งคนที่มีรายการพ้นสภาพ แสดง:</p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ชื่อพนักงาน (หัวการ์ด)</li>
          <li>ป้ายสถานะรายการ (มุมขวา) ดูความหมายที่หัวข้อ &ldquo;ป้ายสถานะรายการ&rdquo; ด้านล่าง</li>
          <li>ป้ายประเภท: &ldquo;ลาออก&rdquo; หรือ &ldquo;เลิกจ้าง&rdquo; (ประเภทเลิกจ้างจะเป็นป้ายสีเน้นเตือน)</li>
          <li>บรรทัด &ldquo;วันทำงานสุดท้าย&rdquo; พร้อมวันที่ (ถ้ายังไม่ระบุจะขึ้นขีด &mdash;)</li>
          <li>ป้ายเล็กสองอันบอกสถานะการลงนาม: &ldquo;พนักงานลงนาม&rdquo; และ &ldquo;ฝ่ายบุคคลลงนาม&rdquo; ถ้าลงนามแล้วจะมีเครื่องหมายถูก ถ้ายังจะเป็นวงกลมโปร่ง</li>
          <li>กดที่การ์ดเพื่อเปิดหน้ารายละเอียด</li>
        </ul>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          ถ้ายังไม่มีข้อมูลจะขึ้นข้อความ &ldquo;ยังไม่มีรายการพ้นสภาพ&rdquo; ถ้าโหลดไม่สำเร็จจะขึ้น &ldquo;โหลดข้อมูลไม่สำเร็จ&rdquo; พร้อมปุ่ม &ldquo;ลองใหม่&rdquo;
        </p>

        <CardSubtitle>ป้ายสถานะรายการ (4 ค่า)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>ร่าง</strong> — เพิ่งเริ่มรายการ ยังแก้ไขข้อมูลและรายการทรัพย์สินได้</li>
          <li><strong>รอลงนาม</strong> — อยู่ระหว่างรอลายเซ็นรับรอง</li>
          <li><strong>เสร็จสิ้น</strong> — ปิดรายการเรียบร้อย (แก้ไขต่อไม่ได้)</li>
          <li><strong>ยกเลิก</strong> — ยกเลิกรายการทิ้ง (แก้ไขต่อไม่ได้)</li>
        </ul>

        <CardSubtitle>ป้ายสถานะการคืนทรัพย์สินแต่ละชิ้น (4 ค่า)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>รอดำเนินการ</strong> — ยังไม่จัดการ (ค่าเริ่มต้น)</li>
          <li><strong>คืนแล้ว</strong></li>
          <li><strong>สูญหาย</strong></li>
          <li><strong>ชำรุด</strong></li>
        </ul>
      </Card>

      <Card>
        <CardTitle icon="🛠️">ขั้นตอนการทำงาน (การพ้นสภาพ)</CardTitle>

        <CardSubtitle>1) เริ่มการพ้นสภาพ (สร้างรายการใหม่)</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดปุ่ม &ldquo;เริ่มการพ้นสภาพ&rdquo; จะเปิดหน้าต่าง &ldquo;เริ่มการพ้นสภาพพนักงาน&rdquo;</li>
          <li>เลือก &ldquo;พนักงาน&rdquo; จากรายการดึงลง (จำเป็นต้องเลือก มิฉะนั้นปุ่มบันทึกจะกดไม่ได้)</li>
          <li>เลือก &ldquo;ประเภท&rdquo;: &ldquo;ลาออก&rdquo; หรือ &ldquo;เลิกจ้าง&rdquo;</li>
          <li>กรอก &ldquo;เหตุผล&rdquo; (ถ้ามี)</li>
          <li>เลือก &ldquo;วันที่แจ้ง&rdquo; (ค่าเริ่มต้นเป็นวันปัจจุบัน) และ &ldquo;วันทำงานสุดท้าย&rdquo; (จะกรอกตอนนี้หรือเข้าไปกรอกในรายละเอียดภายหลังก็ได้)</li>
          <li>กดปุ่ม &ldquo;บันทึก&rdquo;</li>
          <li>ระบบจะสร้างรายการสถานะ &ldquo;ร่าง&rdquo; ขึ้นข้อความ &ldquo;เริ่มการพ้นสภาพแล้ว&rdquo; และเปิดหน้ารายละเอียดให้อัตโนมัติ พร้อมดึง &ldquo;รายการทรัพย์สินที่พนักงานถืออยู่&rdquo; (ทรัพย์สินที่มีสถานะกำลังถือครอง) มาเป็นเช็กลิสต์ให้เอง</li>
        </ol>
        <TipBox>
          ถ้าพนักงานคนนี้มีรายการพ้นสภาพที่กำลังดำเนินการอยู่แล้ว ระบบจะเตือน &ldquo;พนักงานคนนี้มีรายการพ้นสภาพที่กำลังดำเนินการอยู่แล้ว&rdquo; และไม่สร้างซ้ำ
        </TipBox>
        <ManualImg name="hr-offboarding-02-initiate-modal.png" desc="หน้าต่างเริ่มการพ้นสภาพ กรอกพนักงาน ประเภท เหตุผล และวันที่" />

        <CardSubtitle>2) กรอก/แก้ไขรายละเอียด และจัดการทรัพย์สิน (เฉพาะสถานะร่าง)</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดที่การ์ดเพื่อเปิด &ldquo;รายละเอียดการพ้นสภาพ&rdquo;</li>
          <li>ด้านบนมีป้ายประเภท ป้ายสถานะ และป้ายการลงนามของพนักงาน/ฝ่ายบุคคล</li>
          <li>แก้ไขได้ (เฉพาะเมื่อสถานะยังเป็น &ldquo;ร่าง&rdquo;): วันที่แจ้ง, วันทำงานสุดท้าย, เหตุผล, และ &ldquo;หมายเหตุค่าชดเชย&rdquo;</li>
          <li>ในส่วน &ldquo;รายการคืนทรัพย์สิน&rdquo; แต่ละชิ้นจะมีช่องเลือกสถานะการคืน (รอดำเนินการ/คืนแล้ว/สูญหาย/ชำรุด) และช่องกรอก &ldquo;หมายเหตุ&rdquo; ถ้าไม่มีทรัพย์สินจะขึ้น &ldquo;ไม่มีทรัพย์สินที่ต้องคืน&rdquo;</li>
          <li>กดปุ่ม &ldquo;บันทึก&rdquo; (มุมขวาของส่วนทรัพย์สิน) เพื่อบันทึกการแก้ไข ขึ้นข้อความ &ldquo;บันทึกแล้ว&rdquo;</li>
        </ol>
        <TipBox>
          ถ้าสถานะไม่ใช่ร่างแล้ว ช่องต่างๆ จะถูกล็อกแก้ไม่ได้ และหากพยายามบันทึกจะเตือน &ldquo;แก้ไขได้เฉพาะสถานะร่างเท่านั้น&rdquo;
        </TipBox>
        <ManualImg name="hr-offboarding-03-detail-assets.png" desc="หน้ารายละเอียดการพ้นสภาพ แสดงวันที่ เหตุผล หมายเหตุค่าชดเชย และรายการคืนทรัพย์สิน" />

        <CardSubtitle>3) ลงนามฝ่ายบุคคล</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ในหน้ารายละเอียด กดปุ่ม &ldquo;ลงนาม (ฝ่ายบุคคล)&rdquo;</li>
          <li>เปิดหน้าต่าง &ldquo;ลงนามฝ่ายบุคคล&rdquo; ให้เซ็นชื่อในกรอบด้วยเมาส์/นิ้ว</li>
          <li>กด &ldquo;บันทึก&rdquo; เพื่อยืนยัน (หรือกด &ldquo;ล้าง&rdquo; เพื่อเซ็นใหม่) ถ้ายังไม่ได้เซ็นจะเตือน &ldquo;กรุณาเซ็นชื่อก่อน&rdquo;</li>
          <li>เมื่อสำเร็จขึ้น &ldquo;ลงนามแล้ว&rdquo; ป้าย &ldquo;ฝ่ายบุคคลลงนาม&rdquo; จะเปลี่ยนเป็นเครื่องหมายถูก</li>
        </ol>
        <TipBox>
          ปุ่มนี้จะแสดงเฉพาะเมื่อฝ่ายบุคคลยังไม่ได้ลงนาม และรายการยังไม่เสร็จสิ้น/ไม่ถูกยกเลิก การลงนามไม่ใช่เงื่อนไขบังคับก่อนกด &ldquo;เสร็จสิ้น&rdquo; (ดูข้อ 4)
        </TipBox>
        <ManualImg name="hr-offboarding-04-sign-modal.png" desc="หน้าต่างลงนามฝ่ายบุคคล มีกรอบให้เซ็นชื่อ พร้อมปุ่มล้างและบันทึก" />

        <CardSubtitle>4) ทำรายการให้เสร็จสิ้น</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดปุ่ม &ldquo;เสร็จสิ้น&rdquo; ในหน้ารายละเอียด</li>
          <li>
            เงื่อนไขที่ต้องผ่านก่อน (ถ้าไม่ครบ ปุ่มจะกดไม่ได้และมีข้อความเตือนสีเหลือง):
            <ul className="ml-4 mt-1 list-disc space-y-1">
              <li>ต้องระบุ &ldquo;วันทำงานสุดท้าย&rdquo; ก่อน มิฉะนั้นขึ้น &ldquo;ต้องระบุวันทำงานสุดท้ายก่อน&rdquo;</li>
              <li>ทรัพย์สินทุกชิ้นต้องไม่อยู่สถานะ &ldquo;รอดำเนินการ&rdquo; มิฉะนั้นขึ้น &ldquo;ต้องจัดการทรัพย์สินทุกรายการให้เรียบร้อยก่อน&rdquo;</li>
            </ul>
          </li>
          <li>เมื่อกดสำเร็จ ระบบจะขึ้น &ldquo;เสร็จสิ้นแล้ว&rdquo; และดำเนินการอัตโนมัติเบื้องหลัง: เปลี่ยนสถานะพนักงานเป็นลาออก/เลิกจ้าง บันทึกวันสิ้นสุดการทำงาน ปรับสถานะทรัพย์สินตามที่เลือก (คืนแล้ว = ปลดผู้ถือครองและบันทึกวันคืน, สูญหาย/ชำรุด = ปรับสถานะทรัพย์สิน) และปิดการใช้งานบัญชีเข้าระบบของพนักงาน</li>
        </ol>
        <TipBox>
          ขั้นตอนเบื้องหลังบางส่วนเป็นแบบ &ldquo;พยายามให้สำเร็จ&rdquo; หากมีบางรายการติดขัด (เช่น ทรัพย์สินถูกโอนให้คนอื่นไปแล้ว) รายการหลักจะยังเสร็จสิ้น แต่จะมีข้อความเตือนสีเหลืองแจ้งเพิ่มเติมให้ตรวจสอบ
        </TipBox>

        <CardSubtitle>5) พิมพ์แบบฟอร์ม</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          กดปุ่ม &ldquo;พิมพ์&rdquo; ในหน้ารายละเอียด ระบบจะจัดหน้าเป็น &ldquo;แบบฟอร์มการพ้นสภาพพนักงาน&rdquo; สรุปข้อมูลพนักงาน ประเภท เหตุผล วันที่ สถานะ ตารางรายการคืนทรัพย์สิน และช่องลายเซ็นของพนักงานกับฝ่ายบุคคล เหมาะสำหรับพิมพ์เก็บเป็นเอกสาร
        </p>
        <ManualImg name="hr-offboarding-05-print-form.png" desc="ตัวอย่างแบบฟอร์มการพ้นสภาพสำหรับพิมพ์ แสดงข้อมูลพนักงาน ตารางทรัพย์สิน และช่องลายเซ็น" />

        <CardSubtitle>6) ยกเลิกการพ้นสภาพ</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดปุ่ม &ldquo;ยกเลิก&rdquo; (ปุ่มสีแดง) ในหน้ารายละเอียด</li>
          <li>เปิดหน้าต่าง &ldquo;ยกเลิกการพ้นสภาพ&rdquo; ถามยืนยัน &ldquo;ยืนยันการยกเลิกรายการพ้นสภาพนี้หรือไม่?&rdquo;</li>
          <li>กด &ldquo;ยืนยันยกเลิก&rdquo; เพื่อยกเลิก หรือ &ldquo;ไม่ยกเลิก&rdquo; เพื่อปิดหน้าต่าง</li>
          <li>เมื่อสำเร็จขึ้น &ldquo;ยกเลิกแล้ว&rdquo; รายการจะเปลี่ยนเป็นสถานะ &ldquo;ยกเลิก&rdquo;</li>
        </ol>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          ปุ่มยกเลิกและปุ่มเสร็จสิ้นจะแสดงเฉพาะเมื่อรายการยังไม่เสร็จสิ้นและยังไม่ถูกยกเลิก
        </p>
      </Card>

      <Card>
        <CardTitle icon="🔗">เชื่อมโยงกับหน้าอื่น (การพ้นสภาพ)</CardTitle>
        <TableWrap>
          <thead>
            <tr><Th>หน้า/เมนู</Th><Th>เส้นทาง</Th><Th>ความเชื่อมโยง</Th></tr>
          </thead>
          <tbody>
            <tr><Td>เมนูหลักฝ่ายบุคคล</Td><Td><code className="text-xs">/hr</code></Td><Td>จุดเข้าหลักสู่หน้าการพ้นสภาพ (กดช่อง &ldquo;การพ้นสภาพ&rdquo;)</Td></tr>
            <tr><Td>การพ้นสภาพของฉัน (ฝั่งพนักงาน)</Td><Td><code className="text-xs">/me/offboarding</code></Td><Td>พนักงานที่ถูกเริ่มการพ้นสภาพจะเห็นรายการของตนที่นี่ ตรวจสอบรายการคืนทรัพย์สินและ &ldquo;รับทราบ&rdquo; (ลงนาม) ซึ่งจะทำให้ป้าย &ldquo;พนักงานลงนาม&rdquo; ในหน้านี้ติดเครื่องหมายถูก</Td></tr>
            <tr><Td>ทรัพย์สิน</Td><Td><code className="text-xs">/hr/assets</code></Td><Td>รายการทรัพย์สินที่พนักงานถืออยู่ถูกดึงมาเป็นเช็กลิสต์ตอนเริ่มรายการ และเมื่อกดเสร็จสิ้น สถานะทรัพย์สินจะถูกปรับกลับไปที่หน้านี้ (คืนแล้ว/สูญหาย/ชำรุด)</Td></tr>
            <tr><Td>พนักงาน</Td><Td><code className="text-xs">/hr/employees</code></Td><Td>เมื่อเสร็จสิ้น ระบบปรับสถานะพนักงานเป็นลาออก/เลิกจ้าง และบันทึกวันสิ้นสุดการทำงานให้เห็นที่หน้านี้</Td></tr>
            <tr><Td>บันทึกการตรวจสอบ</Td><Td><code className="text-xs">/hr/audit</code></Td><Td>ทุกการกระทำ (เริ่ม, แก้ไข, ลงนาม, เสร็จสิ้น, ยกเลิก, การปรับสถานะพนักงาน/ทรัพย์สิน/ปิดบัญชี) ถูกบันทึกไว้ตรวจสอบย้อนหลังได้</Td></tr>
          </tbody>
        </TableWrap>

        <WarnBox>
          <ul className="ml-4 list-disc space-y-1.5">
            <li>สิทธิ์การเข้าถึง: เฉพาะฝ่ายบุคคลระดับบริษัท หรือผู้จัดการที่มีสิทธิ์ดูแลสาขาของพนักงานคนนั้น จึงจะเริ่มและจัดการรายการพ้นสภาพของพนักงานได้ (ผู้จัดการที่ดูแลเฉพาะสาขาจะเห็นเฉพาะรายการของพนักงานในสาขาตนเอง)</li>
            <li>พนักงานหนึ่งคนมีรายการพ้นสภาพ &ldquo;ที่กำลังดำเนินการ&rdquo; ได้ครั้งละหนึ่งรายการเท่านั้น ระบบจะกันไม่ให้สร้างซ้ำ</li>
            <li>แก้ไขข้อมูลและรายการทรัพย์สินได้เฉพาะตอนสถานะ &ldquo;ร่าง&rdquo; เท่านั้น เมื่อเสร็จสิ้นหรือยกเลิกแล้วจะแก้ไม่ได้</li>
            <li>การกด &ldquo;เสร็จสิ้น&rdquo; มีผลจริงต่อพนักงานทันที (ปิดบัญชี เปลี่ยนสถานะการจ้าง) ควรตรวจข้อมูลและทรัพย์สินให้ครบก่อน เพราะย้อนกลับได้ยาก</li>
            <li>ถ้าหลังเสร็จสิ้นมีข้อความเตือนสีเหลืองเรื่องทรัพย์สิน &ldquo;ไม่ถูกอัปเดต เพราะไม่ได้อยู่กับพนักงานคนนี้แล้ว&rdquo; ให้ไปตรวจสอบที่หน้าทรัพย์สินเพิ่มเติม เพราะทรัพย์สินอาจถูกโอนให้คนอื่นไปแล้ว</li>
            <li>ถ้าทรัพย์สินหายไปจากเช็กลิสต์หรือดึงมาไม่ครบ อาจเป็นเพราะระบบอ่านทรัพย์สินตอนเริ่มไม่สำเร็จ ให้ไปตรวจสอบที่หน้าทรัพย์สินและจัดการด้วยตนเอง</li>
          </ul>
        </WarnBox>
      </Card>
    </>
  );
}
