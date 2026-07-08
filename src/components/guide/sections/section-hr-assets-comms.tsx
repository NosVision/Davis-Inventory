import { Card, CardTitle, CardSubtitle, Step, TipBox, WarnBox, TableWrap, Th, Td, ManualImg } from '../manual-ui';

export function SectionHrAssetsComms() {
  return (
    <>
      {/* ══════════════ ทรัพย์สิน ══════════════ */}
      <Card>
        <CardTitle icon="💼">ทรัพย์สิน</CardTitle>
        <p className="mb-3 text-xs text-gray-400">
          เส้นทาง: <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/assets</code>
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หน้านี้คือ &quot;ทะเบียนทรัพย์สินบริษัท&quot; สำหรับให้ฝ่าย HR บันทึกและติดตามทรัพย์สินของบริษัทที่มอบให้พนักงานถือครองหรือเก็บไว้ในสต๊อก เช่น โน้ตบุ๊ก โทรศัพท์ เครื่องมือ ยูนิฟอร์ม ฯลฯ โดยระบุได้ว่าแต่ละชิ้นชื่ออะไร หมวดไหน มีรหัสอะไร ใครเป็นผู้ถือครอง มูลค่าเท่าไร และตอนนี้อยู่ในสถานะใด (ในสต๊อก / จ่ายแล้ว / คืนแล้ว / สูญหาย / ชำรุด)
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          ด้านบนของหน้าจะสรุปให้เห็นภาพรวมทันทีว่ามีทรัพย์สินทั้งหมดกี่รายการและมูลค่ารวมเท่าไร และยังพิมพ์ทะเบียนทรัพย์สินออกมาเป็นไฟล์ PDF เพื่อใช้ตรวจนับหรือแนบเอกสารได้ด้วย
        </p>

        <CardSubtitle>วิธีเข้าหน้านี้</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เข้าเมนูหลักของ HR ที่หน้า <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr</code> (หน้ารวมเมนูแบบตารางไอคอน)</li>
          <li>กดกล่องเมนูชื่อ <strong>ทรัพย์สิน</strong></li>
        </ol>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          ระบบจะพาเข้าหน้านี้ (<code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/assets</code>) ทันที
        </p>
        <ManualImg name="hr-assets-01-overview.png" desc="ภาพรวมหน้าทรัพย์สิน แสดงการ์ดสรุป ตัวกรอง และตารางรายการ" />
      </Card>

      {/* ── ส่วนประกอบบนหน้าจอ (ทรัพย์สิน) ── */}
      <Card>
        <CardTitle icon="🖥️">ส่วนประกอบบนหน้าจอ</CardTitle>

        <CardSubtitle>หัวข้อและปุ่มด้านบนขวา</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ชื่อหน้า <strong>ทรัพย์สิน</strong> พร้อมคำอธิบาย <strong>ทะเบียนทรัพย์สินบริษัท</strong></li>
          <li>ปุ่ม <strong>พิมพ์ทะเบียน</strong> &mdash; สร้างไฟล์ PDF ทะเบียนทรัพย์สินตามรายการที่กำลังแสดงอยู่ (ปุ่มนี้จะกดไม่ได้/เป็นสีจางเมื่อไม่มีรายการในตาราง)</li>
          <li>ปุ่ม <strong>เพิ่มทรัพย์สิน</strong> &mdash; เปิดหน้าต่างเพื่อบันทึกทรัพย์สินชิ้นใหม่</li>
        </ul>

        <CardSubtitle>การ์ดสรุป (ด้านบน)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>จำนวนรายการ</strong> &mdash; จำนวนทรัพย์สินทั้งหมดที่แสดงอยู่ในตารางตอนนี้ (นับตามตัวกรองที่เลือก)</li>
          <li><strong>มูลค่ารวม</strong> &mdash; ยอดรวมมูลค่า (บาท) ของทรัพย์สินทุกชิ้นที่แสดงอยู่</li>
        </ul>

        <CardSubtitle>ตัวกรอง (แถวถัดลงมา)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ช่อง <strong>ค้นหาชื่อหรือรหัส</strong> &mdash; พิมพ์ชื่อทรัพย์สินหรือรหัสทรัพย์สินเพื่อกรอง (ระบบค้นหาอัตโนมัติหลังหยุดพิมพ์ครู่หนึ่ง)</li>
          <li>ตัวเลือก <strong>สถานะ</strong> &mdash; กรองตามสถานะ เลือก &quot;ทั้งหมด&quot; หรือเจาะจงสถานะเดียว</li>
          <li>ตัวเลือก <strong>ผู้ถือครอง</strong> &mdash; กรองตามพนักงานที่ถือครองทรัพย์สิน เลือก &quot;ทั้งหมด&quot; หรือเจาะจงคน (รายชื่อเป็นพนักงานที่ยัง active อยู่)</li>
        </ul>

        <CardSubtitle>ตารางรายการทรัพย์สิน</CardSubtitle>
        <TableWrap>
          <thead>
            <tr><Th>คอลัมน์</Th><Th>ความหมาย</Th></tr>
          </thead>
          <tbody>
            <tr><Td><strong>ชื่อ</strong></Td><Td>ชื่อทรัพย์สิน และถ้ามีรหัสจะแสดงรหัสตัวเล็กใต้ชื่อ</Td></tr>
            <tr><Td><strong>หมวด</strong></Td><Td>หมวดหมู่ของทรัพย์สิน (ถ้าไม่ได้ระบุจะแสดงขีด &mdash;)</Td></tr>
            <tr><Td><strong>ผู้ถือครอง</strong></Td><Td>ชื่อพนักงานที่ถือครอง ถ้ายังไม่มีผู้ถือครองจะแสดงว่า <strong>ในสต๊อก</strong></Td></tr>
            <tr><Td><strong>มูลค่า</strong></Td><Td>มูลค่าเป็นเงินบาท (ชิดขวา)</Td></tr>
            <tr><Td><strong>สถานะ</strong></Td><Td>ป้ายสีบอกสถานะ</Td></tr>
          </tbody>
        </TableWrap>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          การกดที่แถวใดแถวหนึ่งในตารางจะเปิดหน้าต่างแก้ไขทรัพย์สินชิ้นนั้น ถ้ายังไม่มีทรัพย์สินเลย ตารางจะขึ้นข้อความ <strong>ยังไม่มีทรัพย์สิน</strong>
        </p>

        <CardSubtitle>ความหมายของป้ายสถานะ แต่ละค่า</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>ในสต๊อก</strong> &mdash; ทรัพย์สินยังอยู่ในคลัง ยังไม่ได้จ่ายให้ใคร (ไม่มีผู้ถือครอง)</li>
          <li><strong>จ่ายแล้ว</strong> &mdash; จ่ายให้พนักงานถือครองแล้ว (ต้องมีผู้ถือครองเสมอ)</li>
          <li><strong>คืนแล้ว</strong> &mdash; พนักงานคืนทรัพย์สินกลับมาแล้ว (ไม่มีผู้ถือครอง)</li>
          <li><strong>สูญหาย</strong> &mdash; ทรัพย์สินหาย</li>
          <li><strong>ชำรุด</strong> &mdash; ทรัพย์สินเสียหาย/ใช้งานไม่ได้</li>
        </ul>

        <ManualImg name="hr-assets-02-edit-modal.png" desc="หน้าต่างเพิ่ม/แก้ไขทรัพย์สิน แสดงช่องกรอกทั้งหมด" />

        <CardSubtitle>หน้าต่างเพิ่ม/แก้ไขทรัพย์สิน</CardSubtitle>
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">มีช่องกรอกดังนี้</p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>ชื่อ</strong> (จำเป็นต้องกรอก)</li>
          <li><strong>หมวด</strong></li>
          <li><strong>รหัส</strong> &mdash; รหัสทรัพย์สิน (ห้ามซ้ำกับชิ้นอื่น)</li>
          <li><strong>ผู้ถือครอง</strong> &mdash; เลือก &quot;ในสต๊อก&quot; (ไม่มีผู้ถือครอง) หรือเลือกชื่อพนักงาน</li>
          <li><strong>มูลค่า (บาท)</strong> &mdash; ตัวเลข ต้องไม่ติดลบ</li>
          <li><strong>สถานะ</strong></li>
          <li><strong>จ่ายเมื่อ</strong> &mdash; วันที่จ่ายทรัพย์สิน</li>
          <li><strong>คืนเมื่อ</strong> &mdash; วันที่รับคืน</li>
          <li><strong>หมายเหตุ</strong></li>
          <li>ปุ่มด้านล่าง: <strong>ลบ</strong> (แสดงเฉพาะตอนแก้ไขของเดิม), <strong>ยกเลิก</strong>, และ <strong>บันทึก</strong></li>
        </ul>
      </Card>

      {/* ── ขั้นตอนการทำงาน (ทรัพย์สิน) ── */}
      <Card>
        <CardTitle icon="🧭">ขั้นตอนการทำงาน</CardTitle>

        <CardSubtitle>เพิ่มทรัพย์สินใหม่</CardSubtitle>
        <Step num={1} title="กดปุ่ม เพิ่มทรัพย์สิน">
          <p>เปิดหน้าต่างเพื่อบันทึกทรัพย์สินชิ้นใหม่</p>
        </Step>
        <Step num={2} title="กรอกข้อมูล">
          <p>กรอกอย่างน้อยช่อง <strong>ชื่อ</strong> และกรอกช่องอื่นตามต้องการ</p>
        </Step>
        <Step num={3} title="ตั้งผู้ถือครองเมื่อจ่ายแล้ว">
          <p>ถ้าตั้งสถานะเป็น <strong>จ่ายแล้ว</strong> ต้องเลือก <strong>ผู้ถือครอง</strong> ด้วย มิฉะนั้นระบบจะบันทึกไม่สำเร็จ</p>
        </Step>
        <Step num={4} title="กด บันทึก">
          <p>ระบบขึ้นข้อความ <strong>บันทึกแล้ว</strong> และรายการใหม่จะปรากฏบนสุดของตาราง</p>
        </Step>

        <CardSubtitle>แก้ไขทรัพย์สิน</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดที่แถวของทรัพย์สินในตาราง</li>
          <li>แก้ไขข้อมูลในหน้าต่างที่เปิดขึ้น</li>
          <li>กด <strong>บันทึก</strong> เพื่อยืนยัน</li>
        </ol>

        <CardSubtitle>ลบทรัพย์สิน</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดที่แถวเพื่อเปิดหน้าต่างแก้ไข</li>
          <li>กดปุ่ม <strong>ลบ</strong></li>
          <li>ระบบถามยืนยัน <strong>ลบทรัพย์สินนี้?</strong> &mdash; กดยืนยันเพื่อลบถาวร</li>
        </ol>

        <CardSubtitle>พิมพ์ทะเบียนทรัพย์สิน (PDF)</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ตั้งตัวกรอง (ค้นหา/สถานะ/ผู้ถือครอง) ให้ได้รายการที่ต้องการก่อน เพราะ PDF จะพิมพ์เฉพาะรายการที่แสดงอยู่ในตารางตอนนั้น</li>
          <li>กดปุ่ม <strong>พิมพ์ทะเบียน</strong></li>
          <li>ระบบสร้างไฟล์ PDF (แนวนอน) ที่มีเลขลำดับ รหัส ชื่อ หมวด ผู้ถือครอง มูลค่า สถานะ พร้อมสรุปจำนวนรายการและมูลค่ารวม แล้วดาวน์โหลดลงเครื่องอัตโนมัติ พร้อมข้อความ <strong>สร้าง PDF แล้ว</strong></li>
        </ol>

        <TipBox>
          <strong>เกร็ด:</strong> เมื่อกดบันทึกทุกครั้ง หากตั้งสถานะเป็น <strong>คืนแล้ว</strong> หรือ <strong>ในสต๊อก</strong> ระบบจะล้างผู้ถือครองออกให้เองโดยอัตโนมัติ (เพราะถือว่าไม่มีคนถืออยู่แล้ว)
        </TipBox>
      </Card>

      {/* ── เชื่อมโยง + ข้อควรระวัง (ทรัพย์สิน) ── */}
      <Card>
        <CardTitle icon="🔗">เชื่อมโยงกับหน้าอื่น &amp; ข้อควรระวัง (ทรัพย์สิน)</CardTitle>

        <CardSubtitle>เชื่อมโยงกับหน้าอื่น</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>เมนูหลัก HR</strong> (<code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr</code> &mdash; หน้ารวมเมนู): เป็นทางเข้าหลักของหน้านี้</li>
          <li><strong>รายชื่อผู้ถือครอง</strong>: ช่องผู้ถือครองและตัวกรองผู้ถือครองดึงรายชื่อจากพนักงานที่ยัง active อยู่ในระบบ ดังนั้นพนักงานที่ลาออก/ปิดการใช้งานจะไม่ปรากฏให้เลือก</li>
          <li>ข้อมูลทรัพย์สินนี้เป็นทะเบียนเฉพาะของหน้านี้ ไม่ได้ไหลไปคำนวณเงินเดือนหรือหักโควตาที่หน้าอื่นโดยตรง</li>
        </ul>

        <WarnBox>
          <CardSubtitle>หมายเหตุ/ข้อควรระวัง</CardSubtitle>
          <ul className="ml-5 list-disc space-y-1.5">
            <li><strong>ช่องชื่อจำเป็นต้องกรอก</strong> ถ้าเว้นว่างจะขึ้นข้อความ <strong>ต้องระบุชื่อ</strong> และบันทึกไม่ได้</li>
            <li><strong>มูลค่าต้องไม่ติดลบ</strong> ถ้ากรอกค่าลบจะบันทึกไม่สำเร็จ (ช่องนี้รับเฉพาะตัวเลข)</li>
            <li><strong>รหัสทรัพย์สินห้ามซ้ำ</strong> ถ้ากรอกรหัสที่มีอยู่แล้วในระบบ จะบันทึกไม่สำเร็จ</li>
            <li><strong>สถานะจ่ายแล้วต้องมีผู้ถือครอง</strong> ถ้าเลือกสถานะจ่ายแล้วแต่ไม่เลือกคน ระบบจะบันทึกไม่สำเร็จ</li>
            <li><strong>สิทธิ์การเข้าถึง</strong>: การเพิ่ม/แก้ไข/ลบ ทำได้เฉพาะผู้มีสิทธิ์ระดับผู้จัดการ HR เท่านั้น</li>
            <li><strong>ขอบเขตการมองเห็นตามสาขา</strong>: HR ระดับบริษัทเห็นทรัพย์สินทุกชิ้น ส่วนผู้จัดการที่ถูกจำกัดสาขาจะเห็นเฉพาะทรัพย์สินที่พนักงานในสาขาของตนถือครอง (ส่วนทรัพย์สินที่อยู่ในสต๊อก/ไม่มีผู้ถือครอง สงวนให้ HR ระดับบริษัทดูแลเท่านั้น) การแก้ไขทรัพย์สินที่มีผู้ถือครองก็ต้องมีสิทธิ์ในสาขาของผู้ถือครองคนนั้นด้วย</li>
            <li>ถ้าบันทึกไม่สำเร็จ ระบบจะขึ้นข้อความ <strong>บันทึกไม่สำเร็จ</strong> พร้อมเหตุผล (เช่น รหัสซ้ำ, ไม่พบผู้ถือครอง) ให้แก้ไขตามคำแนะนำแล้วลองใหม่</li>
          </ul>
        </WarnBox>
      </Card>

      {/* ══════════════ นโยบาย ══════════════ */}
      <Card>
        <CardTitle icon="📜">นโยบาย</CardTitle>
        <p className="mb-3 text-xs text-gray-400">
          เส้นทาง: <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/policies</code>
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หน้า &quot;นโยบาย&quot; คือที่ที่ฝ่าย HR ใช้จัดเก็บและเผยแพร่ &quot;คู่มือและนโยบายบริษัท&quot; ให้พนักงานทุกคนได้อ่านและกดรับทราบ เช่น นโยบายการเข้างาน กฎวินัย ระเบียบการลา ฯลฯ HR สามารถสร้างนโยบายใหม่ แก้ไขเนื้อหา เปิด/ปิดการใช้งาน และออก &quot;เวอร์ชันใหม่&quot; เมื่อมีการปรับปรุงเนื้อหาสำคัญ
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          นอกจากนั้นหน้านี้ยังใช้ตรวจสอบว่าพนักงานคนไหน &quot;รับทราบ&quot; นโยบายแต่ละฉบับไปแล้วบ้าง พร้อมดูวันเวลาที่รับทราบและลายเซ็นดิจิทัลที่พนักงานเซ็นไว้ นโยบายที่เปิดใช้งานจะไปปรากฏให้พนักงานอ่านและกดรับทราบที่หน้าของพนักงานเอง
        </p>

        <CardSubtitle>วิธีเข้าหน้านี้</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เข้าเมนูหลักของ HR ที่ <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr</code> (หน้าตารางไอคอนรวมเมนู HR ทั้งหมด)</li>
          <li>กดการ์ด/ไอคอนชื่อ <strong>นโยบาย</strong></li>
          <li>ระบบจะพาเข้าหน้า <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/policies</code></li>
        </ol>
        <TipBox>
          เฉพาะผู้ที่เป็นเจ้าของระบบ (owner) หรือมีสิทธิ์ &quot;จัดการ HR&quot; เท่านั้นที่จะเข้าหน้านี้ได้ ถ้าไม่มีสิทธิ์ ระบบจะไม่อนุญาต
        </TipBox>
        <ManualImg name="hr-policies-01-overview.png" desc="ภาพรวมหน้านโยบาย: การ์ดสรุปด้านบนและรายการนโยบาย" />
      </Card>

      {/* ── ส่วนประกอบบนหน้าจอ (นโยบาย) ── */}
      <Card>
        <CardTitle icon="🖥️">ส่วนประกอบบนหน้าจอ (นโยบาย)</CardTitle>

        <CardSubtitle>ส่วนหัวของหน้า</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ชื่อหน้า <strong>นโยบาย</strong> และคำบรรยาย <strong>คู่มือและนโยบายบริษัท</strong></li>
          <li>ปุ่มสลับมุมมอง (มุมขวาบน): ใช้สลับการแสดงรายการระหว่างแบบปกติกับแบบกระชับ (แสดงข้อมูลถี่ขึ้น) เป็นเพียงการปรับความหนาแน่นของการแสดงผล ไม่กระทบข้อมูล</li>
          <li>ปุ่ม <strong>เพิ่มนโยบาย</strong> (มีเครื่องหมายบวก): กดเพื่อสร้างนโยบายฉบับใหม่</li>
        </ul>

        <CardSubtitle>การ์ดสรุปตัวเลข (แสดงเมื่อมีนโยบายอย่างน้อย 1 ฉบับ)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>นโยบาย</strong> &mdash; จำนวนนโยบายทั้งหมด</li>
          <li><strong>ใช้งาน</strong> &mdash; จำนวนนโยบายที่เปิดใช้งานอยู่</li>
          <li><strong>ปิดใช้งาน</strong> &mdash; จำนวนนโยบายที่ถูกปิดใช้งาน</li>
        </ul>

        <CardSubtitle>รายการนโยบาย (การ์ดแต่ละใบ = นโยบาย 1 ฉบับ)</CardSubtitle>
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">แต่ละการ์ดแสดง:</p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>หัวข้อ</strong> ของนโยบาย</li>
          <li>ป้ายสถานะ: <strong>ใช้งาน</strong> (สีเขียว) หรือ <strong>ปิดใช้งาน</strong> (สีเทา)</li>
          <li>ป้ายเวอร์ชัน เช่น <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">v1</code>, <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">v2</code> (ตัวเลขเวอร์ชันปัจจุบันของนโยบาย)</li>
          <li><strong>หมวด</strong> ของนโยบาย (ถ้าระบุไว้) เช่น การเข้างาน หรือ วินัย</li>
        </ul>
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">ปุ่มการทำงานในแต่ละการ์ด:</p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ไอคอนรูปคน (คำอธิบายเมื่อชี้เมาส์: <strong>การรับทราบ</strong>) &mdash; เปิดรายชื่อคนที่รับทราบนโยบายฉบับนี้</li>
          <li>ไอคอนรูปดินสอ (<strong>แก้ไข</strong>) &mdash; เปิดหน้าต่างแก้ไขนโยบาย</li>
          <li>ปุ่ม <strong>ปิดใช้งาน</strong> (เมื่อนโยบายกำลังใช้งานอยู่) หรือ <strong>เปิดใช้งาน</strong> (เมื่อถูกปิดอยู่) &mdash; สลับสถานะการใช้งานทันที</li>
        </ul>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          ถ้ายังไม่มีนโยบายเลย หน้าจะแสดงข้อความ <strong>ยังไม่มีนโยบาย</strong>
        </p>

        <CardSubtitle>หน้าต่างเพิ่ม/แก้ไขนโยบาย</CardSubtitle>
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">เมื่อกด &quot;เพิ่มนโยบาย&quot; หรือ &quot;แก้ไข&quot; จะมีหน้าต่างเด้งขึ้น มีช่องกรอก:</p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>หัวข้อ</strong> (จำเป็นต้องกรอก) &mdash; ตัวอย่างข้อความช่วย: &quot;หัวข้อนโยบาย&quot;</li>
          <li><strong>หมวด</strong> &mdash; ตัวอย่างข้อความช่วย: &quot;เช่น การเข้างาน, วินัย&quot;</li>
          <li><strong>เนื้อหา</strong> &mdash; ช่องข้อความขนาดใหญ่สำหรับใส่รายละเอียดนโยบาย รองรับการจัดรูปแบบ <strong>Markdown</strong> (หัวข้อ <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-700"># หัวข้อ</code>, ตาราง <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-700">| ... |</code>, รายการ <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-700">- ข้อ</code>, ตัวหนา <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-700">**เน้น**</code>) — ฝั่งพนักงานจะแสดงผลเป็นเอกสารจัดรูปแบบสวยงาม อ่านง่ายทั้งจอเล็กและจอใหญ่</li>
          <li>(เฉพาะตอนแก้ไข) ช่องติ๊ก <strong>ใช้งาน</strong> &mdash; เปิด/ปิดการใช้งานนโยบาย</li>
          <li>(เฉพาะตอนแก้ไข) ช่องติ๊ก <strong>ออกเวอร์ชันใหม่ (ต้องรับทราบใหม่)</strong> &mdash; สั่งให้ระบบเลื่อนเลขเวอร์ชันขึ้น ทำให้พนักงานทุกคนต้องกลับมากดรับทราบใหม่อีกครั้ง</li>
          <li>ปุ่มด้านล่าง: <strong>ยกเลิก</strong> และ <strong>บันทึก</strong></li>
        </ul>
        <ManualImg name="hr-policies-02-editor-modal.png" desc="หน้าต่างแก้ไขนโยบาย พร้อมช่องติ๊กออกเวอร์ชันใหม่" />

        <CardSubtitle>หน้าต่างการรับทราบ</CardSubtitle>
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">
          เมื่อกดไอคอนรูปคน จะเปิดหน้าต่าง <strong>การรับทราบ</strong> แสดงรายชื่อพนักงานที่รับทราบนโยบายฉบับนั้น เรียงจากล่าสุดก่อน แต่ละแถวแสดง:
        </p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ชื่อพนักงาน</li>
          <li>วันเวลาที่กดรับทราบ</li>
          <li>ไอคอนรูปตา (<strong>ดู</strong>) &mdash; ปรากฏเฉพาะเมื่อพนักงานเซ็นลายเซ็นไว้ กดเพื่อเปิดดูไฟล์ลายเซ็นในแท็บใหม่</li>
          <li>ป้ายเวอร์ชันที่พนักงานรับทราบ เช่น <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">v1</code> (บอกว่ารับทราบเวอร์ชันไหนไป)</li>
        </ul>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          ถ้ายังไม่มีใครรับทราบ จะแสดงข้อความ <strong>ยังไม่มีการรับทราบ</strong>
        </p>
        <ManualImg name="hr-policies-03-acks-modal.png" desc="หน้าต่างการรับทราบ: รายชื่อพนักงาน วันเวลา และลายเซ็น" />
      </Card>

      {/* ── ขั้นตอนการทำงาน (นโยบาย) ── */}
      <Card>
        <CardTitle icon="🧭">ขั้นตอนการทำงาน (นโยบาย)</CardTitle>

        <CardSubtitle>เพิ่มนโยบายใหม่</CardSubtitle>
        <Step num={1} title="กดปุ่ม เพิ่มนโยบาย">
          <p>เปิดหน้าต่างสร้างนโยบายฉบับใหม่</p>
        </Step>
        <Step num={2} title="กรอกหัวข้อ">
          <p>ต้องกรอก มิฉะนั้นจะขึ้นเตือน &quot;ต้องระบุหัวข้อ&quot;</p>
        </Step>
        <Step num={3} title="กรอกหมวด และ เนื้อหา ตามต้องการ">
          <p>ใส่รายละเอียดนโยบายในช่องเนื้อหา</p>
        </Step>
        <Step num={4} title="กด บันทึก">
          <p>ระบบแจ้ง <strong>บันทึกแล้ว</strong> นโยบายใหม่จะถูกสร้างเป็นเวอร์ชัน 1 และเปิดใช้งานทันที จากนั้นจะไปปรากฏให้พนักงานอ่านและรับทราบที่หน้าพนักงาน</p>
        </Step>

        <CardSubtitle>แก้ไขนโยบาย</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดไอคอนรูปดินสอ (<strong>แก้ไข</strong>) บนการ์ดนโยบายที่ต้องการ</li>
          <li>แก้หัวข้อ/หมวด/เนื้อหา ได้ตามต้องการ</li>
          <li>ถ้าต้องการให้พนักงานกลับมารับทราบใหม่ ให้ติ๊ก <strong>ออกเวอร์ชันใหม่ (ต้องรับทราบใหม่)</strong></li>
          <li>กด <strong>บันทึก</strong> ระบบแจ้ง <strong>บันทึกแล้ว</strong></li>
        </ol>
        <WarnBox>
          <strong>หมายเหตุสำคัญ:</strong> หากคุณแก้ <strong>หัวข้อ</strong> หรือ <strong>เนื้อหา</strong> ให้ต่างจากเดิม ระบบจะเลื่อนเลขเวอร์ชันขึ้นให้โดยอัตโนมัติ (พนักงานต้องรับทราบใหม่) แม้จะไม่ได้ติ๊กช่องออกเวอร์ชันใหม่ก็ตาม ถ้าแก้เฉพาะ &quot;หมวด&quot; หรือสถานะใช้งาน เวอร์ชันจะไม่เปลี่ยน
        </WarnBox>

        <CardSubtitle>เปิด/ปิดการใช้งานนโยบาย</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดปุ่ม <strong>ปิดใช้งาน</strong> เพื่อซ่อนนโยบายไม่ให้พนักงานเห็น หรือกด <strong>เปิดใช้งาน</strong> เพื่อนำกลับมาแสดง</li>
          <li>ทำได้ทันทีจากการ์ด หรือจะติ๊กช่อง <strong>ใช้งาน</strong> ในหน้าต่างแก้ไขก็ได้ ผลอย่างเดียวกัน</li>
        </ul>

        <CardSubtitle>ตรวจสอบว่าใครรับทราบแล้ว</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดไอคอนรูปคน (<strong>การรับทราบ</strong>) บนการ์ดนโยบาย</li>
          <li>ดูรายชื่อพนักงานพร้อมวันเวลาที่รับทราบ และเวอร์ชันที่รับทราบ</li>
          <li>ถ้ามีลายเซ็น กดไอคอนรูปตา (<strong>ดู</strong>) เพื่อเปิดดูไฟล์ลายเซ็นในแท็บใหม่</li>
        </ol>
      </Card>

      {/* ── เชื่อมโยง + ข้อควรระวัง (นโยบาย) ── */}
      <Card>
        <CardTitle icon="🔗">เชื่อมโยงกับหน้าอื่น &amp; ข้อควรระวัง (นโยบาย)</CardTitle>

        <CardSubtitle>เชื่อมโยงกับหน้าอื่น</CardSubtitle>
        <TableWrap>
          <thead>
            <tr><Th>หน้า/เมนู</Th><Th>เส้นทาง</Th><Th>ข้อมูลไหลอย่างไร</Th></tr>
          </thead>
          <tbody>
            <tr>
              <Td>นโยบาย (ฝั่งพนักงาน)</Td>
              <Td><code className="text-xs">/me/policies</code></Td>
              <Td>นโยบายที่ HR &quot;เปิดใช้งาน&quot; จากหน้านี้ จะไปแสดงให้พนักงานอ่านและกดรับทราบ เมื่อพนักงานรับทราบ (พร้อมลายเซ็น) รายการจะย้อนกลับมาแสดงในหน้าต่าง &quot;การรับทราบ&quot; ของหน้านี้ทันที</Td>
            </tr>
            <tr>
              <Td>เมนูหลัก HR</Td>
              <Td><code className="text-xs">/hr</code></Td>
              <Td>ทางเข้าหน้านโยบาย (กดการ์ด &quot;นโยบาย&quot;)</Td>
            </tr>
            <tr>
              <Td>ประกาศ</Td>
              <Td><code className="text-xs">/hr/announcements</code></Td>
              <Td>คนละส่วนกับนโยบาย แต่เป็นช่องทางสื่อสารกับพนักงานเช่นเดียวกัน (ประกาศเน้นแจ้งข่าว นโยบายเน้นเอกสารที่ต้องรับทราบ)</Td>
            </tr>
          </tbody>
        </TableWrap>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          การทำงานร่วมของเวอร์ชัน: เมื่อออกเวอร์ชันใหม่ พนักงานที่เคยรับทราบเวอร์ชันเก่าจะถูกถือว่ายังไม่รับทราบเวอร์ชันปัจจุบัน และต้องกลับไปรับทราบใหม่ที่ <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/me/policies</code>
        </p>

        <WarnBox>
          <CardSubtitle>หมายเหตุ/ข้อควรระวัง</CardSubtitle>
          <ul className="ml-5 list-disc space-y-1.5">
            <li><strong>หัวข้อเป็นช่องบังคับ</strong> ถ้าเว้นว่างจะบันทึกไม่ได้ (ขึ้นเตือน &quot;ต้องระบุหัวข้อ&quot;)</li>
            <li><strong>การแก้หัวข้อหรือเนื้อหา = ออกเวอร์ชันใหม่โดยอัตโนมัติ</strong> พนักงานทุกคนต้องรับทราบใหม่ ควรใช้เมื่อเนื้อหาเปลี่ยนจริงจัง หากเป็นการแก้เล็กน้อยที่ไม่อยากรบกวนพนักงาน ให้ระวังจุดนี้</li>
            <li><strong>สิทธิ์การเข้าถึง</strong> เฉพาะเจ้าของระบบหรือผู้มีสิทธิ์จัดการ HR เท่านั้น คนอื่นเข้าไม่ได้</li>
            <li><strong>การแก้ไขพร้อมกันหลายคน</strong> ระบบมีระบบป้องกันการเขียนทับ ถ้ามีคนอื่นแก้นโยบายเดียวกันพร้อมกันจนเวอร์ชันไม่ตรง ระบบจะแจ้งว่านโยบายถูกแก้โดยคนอื่นและให้โหลดหน้าใหม่ก่อนแก้ซ้ำ</li>
            <li><strong>ปุ่มการทำงานจะถูกระงับชั่วคราว</strong> ระหว่างที่ระบบกำลังบันทึก เพื่อกันการกดซ้ำ</li>
            <li>หากบันทึกไม่สำเร็จ ระบบจะแจ้ง <strong>บันทึกไม่สำเร็จ</strong> พร้อมสาเหตุ (ถ้ามี) ให้ลองใหม่หรือตรวจสอบการเชื่อมต่อ</li>
          </ul>
        </WarnBox>
      </Card>

      {/* ══════════════ ประกาศ ══════════════ */}
      <Card>
        <CardTitle icon="📢">ประกาศ</CardTitle>
        <p className="mb-3 text-xs text-gray-400">
          เส้นทาง: <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/announcements</code>
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หน้า &quot;ประกาศ&quot; ใช้สำหรับสร้างและจัดการประกาศภายในบริษัทที่ต้องการส่งถึงพนักงาน เช่น ประกาศวันหยุด นโยบายใหม่ การเปลี่ยนแปลงเวลาทำงาน หรือข่าวสารต่าง ๆ คุณสามารถกำหนดได้ว่าประกาศแต่ละอันจะส่งถึงพนักงานทุกสาขา หรือเจาะจงเฉพาะบางสาขา
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          เมื่อสร้างประกาศแล้ว พนักงานที่อยู่ในขอบเขตของประกาศนั้นจะเห็นประกาศในหน้าของตัวเอง (หน้าประกาศฝั่งพนักงาน) และสามารถกด &quot;รับทราบ&quot; ได้ ซึ่งจากหน้านี้คุณจะติดตามได้ว่ามีพนักงานกี่คนที่รับทราบประกาศแล้ว รวมทั้งดูรายชื่อและเวลาที่แต่ละคนกดรับทราบ
        </p>
        <ManualImg name="hr-announcements-01-overview.png" desc="ภาพรวมหน้าประกาศ แสดงการ์ดสรุปและรายการประกาศ" />

        <CardSubtitle>วิธีเข้าหน้านี้</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เข้าเมนูหลักของงานบุคคล (HR) ที่หน้า <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr</code> ซึ่งเป็นตารางไอคอนเมนูทั้งหมด</li>
          <li>กดไอคอน <strong>ประกาศถึงพนักงาน</strong> (รูปโทรโข่ง)</li>
          <li>ระบบจะเปิดหน้าจัดการประกาศ</li>
        </ol>
        <TipBox>
          หน้านี้เปิดได้เฉพาะผู้ใช้ที่มีสิทธิ์จัดการงานบุคคล (HR) เท่านั้น หากบัญชีของคุณไม่มีสิทธิ์ ระบบจะไม่อนุญาตให้เข้าถึงข้อมูล
        </TipBox>
      </Card>

      {/* ── ส่วนประกอบบนหน้าจอ (ประกาศ) ── */}
      <Card>
        <CardTitle icon="🖥️">ส่วนประกอบบนหน้าจอ (ประกาศ)</CardTitle>

        <CardSubtitle>แถบหัวข้อด้านบน</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ชื่อหน้า <strong>ประกาศ</strong> และคำอธิบาย <strong>ประกาศตามสาขา</strong></li>
          <li>ปุ่มสลับมุมมอง สำหรับสลับระหว่างมุมมองปกติกับมุมมองแบบกระชับ (แสดงรายการชิดกันมากขึ้น) &mdash; ไม่กระทบข้อมูล เป็นแค่การจัดวางบนจอ</li>
          <li>ปุ่ม <strong>เพิ่มประกาศ</strong> (มีเครื่องหมายบวก) สำหรับสร้างประกาศใหม่</li>
        </ul>

        <CardSubtitle>การ์ดสรุป (แสดงเมื่อมีประกาศอย่างน้อย 1 รายการ)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>ประกาศ</strong> &mdash; จำนวนประกาศทั้งหมด</li>
          <li><strong>ใช้งาน</strong> &mdash; จำนวนประกาศที่กำลังเปิดใช้งานอยู่</li>
          <li><strong>รับทราบแล้ว</strong> &mdash; ยอดรวมจำนวนครั้งที่พนักงานกดรับทราบจากทุกประกาศรวมกัน</li>
        </ul>

        <CardSubtitle>รายการประกาศ (การ์ดรายอัน)</CardSubtitle>
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">แต่ละการ์ดประกอบด้วย:</p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>หัวข้อประกาศ</strong></li>
          <li><strong>ป้ายสถานะ</strong> ทางขวา มี 2 ค่า: <strong>ใช้งาน</strong> (สีเขียว) = ประกาศกำลังแสดงต่อพนักงาน &middot; <strong>ปิดใช้งาน</strong> (สีเทา) = ประกาศถูกปิด พนักงานจะไม่เห็น</li>
          <li><strong>ขอบเขต:</strong> บอกว่าประกาศนี้ส่งถึงใคร &mdash; ถ้าเขียนว่า <strong>ทุกสาขา</strong> คือส่งถึงพนักงานทั้งบริษัท ถ้าเป็นชื่อสาขาคือส่งเฉพาะสาขาที่ระบุ</li>
          <li><strong>รับทราบแล้ว:</strong> ตามด้วยจำนวนพนักงานที่กดรับทราบประกาศนี้</li>
        </ul>
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">ปุ่มในแต่ละการ์ด (เรียงจากซ้ายไปขวา):</p>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ปุ่มรูปดวงตา <strong>การรับทราบ</strong> &mdash; เปิดหน้าต่างดูรายชื่อผู้ที่รับทราบ</li>
          <li>ปุ่มรูปดินสอ <strong>แก้ไข</strong> &mdash; เปิดหน้าต่างแก้ไขประกาศ</li>
          <li>ปุ่ม <strong>ปิดใช้งาน</strong> / <strong>เปิดใช้งาน</strong> &mdash; สลับเปิด/ปิดประกาศ (ข้อความบนปุ่มเปลี่ยนตามสถานะปัจจุบัน: ถ้าประกาศกำลังใช้งานอยู่ปุ่มจะเขียนว่า &quot;ปิดใช้งาน&quot; และในทางกลับกัน)</li>
        </ul>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หากยังไม่มีประกาศเลย หน้าจะแสดงข้อความ <strong>ยังไม่มีประกาศ</strong>
        </p>
      </Card>

      {/* ── ขั้นตอนการทำงาน (ประกาศ) ── */}
      <Card>
        <CardTitle icon="🧭">ขั้นตอนการทำงาน (ประกาศ)</CardTitle>

        <CardSubtitle>สร้างประกาศใหม่</CardSubtitle>
        <Step num={1} title="กดปุ่ม เพิ่มประกาศ (มุมขวาบน)">
          <p>เปิดหน้าต่างสร้างประกาศใหม่</p>
        </Step>
        <Step num={2} title="กรอกหัวข้อ">
          <p>ช่องนี้บังคับ ต้องมีข้อความ</p>
        </Step>
        <Step num={3} title="กรอกข้อความ (ไม่บังคับ)">
          <p>ใส่เนื้อหาประกาศ</p>
        </Step>
        <Step num={4} title="เลือกขอบเขต">
          <p>ติ๊กเลือกสาขาจากรายการที่แสดง &mdash; ถ้าต้องการส่งถึงทุกสาขา ให้ <strong>ไม่ติ๊กสาขาใดเลย</strong> ระบบจะขึ้นคำว่า &quot;ทุกสาขา&quot; ให้อัตโนมัติ</p>
        </Step>
        <Step num={5} title="กด บันทึก">
          <p>ระบบจะแจ้ง &quot;บันทึกแล้ว&quot; และประกาศจะปรากฏในรายการทันที (ประกาศที่สร้างใหม่จะเป็นสถานะใช้งานเสมอ)</p>
        </Step>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หากไม่ได้กรอกหัวข้อแล้วกดบันทึก ระบบจะเตือน <strong>ต้องระบุหัวข้อ</strong> และไม่บันทึกให้
        </p>
        <ManualImg name="hr-announcements-02-editor-modal.png" desc="หน้าต่างสร้าง/แก้ไขประกาศ พร้อมช่องหัวข้อ ข้อความ และการเลือกขอบเขตสาขา" />
        <ManualImg name="hr-announcements-03-scope-select.png" desc="การเลือกขอบเขตสาขาแบบติ๊กหลายสาขา ไม่ติ๊กเลยหมายถึงทุกสาขา" />

        <CardSubtitle>แก้ไขประกาศ</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดปุ่มรูปดินสอ <strong>แก้ไข</strong> ที่การ์ดประกาศ</li>
          <li>หน้าต่างจะเปิดพร้อมข้อมูลเดิม แก้ไขหัวข้อ ข้อความ หรือขอบเขตได้ตามต้องการ</li>
          <li>เฉพาะตอนแก้ไขจะมีช่องติ๊ก <strong>ใช้งาน</strong> เพิ่มเข้ามา ใช้เปิด/ปิดการแสดงประกาศได้จากในหน้าต่างนี้เช่นกัน</li>
          <li>กด <strong>บันทึก</strong> หรือกด <strong>ยกเลิก</strong> เพื่อปิดโดยไม่บันทึก</li>
        </ol>

        <CardSubtitle>เปิด/ปิดการใช้งานประกาศแบบเร็ว</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดปุ่ม <strong>ปิดใช้งาน</strong> ที่การ์ด เพื่อหยุดแสดงประกาศต่อพนักงานทันที (ป้ายสถานะจะเปลี่ยนเป็น &quot;ปิดใช้งาน&quot;)</li>
          <li>กดปุ่ม <strong>เปิดใช้งาน</strong> เพื่อกลับมาแสดงประกาศอีกครั้ง</li>
          <li>ระบบจะแจ้ง &quot;บันทึกแล้ว&quot; หลังทำรายการสำเร็จ</li>
        </ul>

        <CardSubtitle>ดูว่าใครรับทราบแล้วบ้าง</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>กดปุ่มรูปดวงตา <strong>การรับทราบ</strong> ที่การ์ดประกาศ</li>
          <li>หน้าต่างจะแสดงรายชื่อพนักงานที่กด &quot;รับทราบ&quot; ประกาศนี้ พร้อม <strong>วันและเวลา</strong> ที่กด และป้าย <strong>รับทราบแล้ว</strong></li>
          <li>ถ้ายังไม่มีใครกดรับทราบ จะแสดงข้อความ <strong>ยังไม่มีการรับทราบ</strong></li>
        </ol>
        <ManualImg name="hr-announcements-04-receipts-modal.png" desc="หน้าต่างการรับทราบ แสดงรายชื่อพนักงานและเวลาที่กดรับทราบ" />
      </Card>

      {/* ── เชื่อมโยง + ข้อควรระวัง (ประกาศ) ── */}
      <Card>
        <CardTitle icon="🔗">เชื่อมโยงกับหน้าอื่น &amp; ข้อควรระวัง (ประกาศ)</CardTitle>

        <CardSubtitle>เชื่อมโยงกับหน้าอื่น</CardSubtitle>
        <TableWrap>
          <thead>
            <tr><Th>หน้า</Th><Th>เส้นทาง</Th><Th>ข้อมูลไหลอย่างไร</Th></tr>
          </thead>
          <tbody>
            <tr>
              <Td>ประกาศ (ฝั่งพนักงาน)</Td>
              <Td><code className="text-xs">/me/announcements</code></Td>
              <Td>ประกาศที่คุณสร้างและเปิดใช้งานจะไปแสดงให้พนักงานที่อยู่ในขอบเขตเห็นที่นี่ พนักงานกด &quot;รับทราบ&quot; หรือ &quot;ภายหลัง&quot; ได้ เมื่อกดรับทราบ ยอดจะกลับมานับที่ช่อง &quot;รับทราบแล้ว&quot; และในหน้าต่างการรับทราบของหน้านี้</Td>
            </tr>
            <tr>
              <Td>ของฉัน (หน้ารวมงานบุคคลฝั่งพนักงาน)</Td>
              <Td><code className="text-xs">/me</code></Td>
              <Td>เป็นหน้ารวมเมนูงานบุคคลฝั่งพนักงาน ซึ่งมีทางเข้าไปยังหน้าประกาศของพนักงาน</Td>
            </tr>
            <tr>
              <Td>ตั้งค่า (รายการสาขา)</Td>
              <Td><code className="text-xs">/settings</code></Td>
              <Td>รายชื่อสาขาที่เลือกได้ในช่อง &quot;ขอบเขต&quot; มาจากสาขาที่เปิดใช้งานอยู่ในระบบ (เฉพาะสาขาที่ยังใช้งานอยู่) ซึ่งจัดการที่หน้านี้</Td>
            </tr>
            <tr>
              <Td>เมนูหลักงานบุคคล</Td>
              <Td><code className="text-xs">/hr</code></Td>
              <Td>ทางเข้าหลักของหน้านี้ (ไอคอน &quot;ประกาศถึงพนักงาน&quot;)</Td>
            </tr>
          </tbody>
        </TableWrap>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          การไหลของข้อมูลโดยสรุป: สร้างประกาศที่ <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/announcements</code> &rarr; เปิดใช้งาน &rarr; พนักงานในขอบเขตเห็นที่ <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/me/announcements</code> &rarr; พนักงานกดรับทราบ &rarr; ยอดและรายชื่อการรับทราบกลับมาแสดงที่หน้านี้
        </p>

        <WarnBox>
          <CardSubtitle>หมายเหตุ / ข้อควรระวัง</CardSubtitle>
          <ul className="ml-5 list-disc space-y-1.5">
            <li><strong>หัวข้อเป็นข้อมูลบังคับ</strong> ถ้าเว้นว่างจะบันทึกไม่ได้และขึ้นเตือน &quot;ต้องระบุหัวข้อ&quot;</li>
            <li><strong>ไม่ติ๊กสาขาใดเลย = ส่งถึงทุกสาขา</strong> ระวังสับสน หากต้องการเจาะจงสาขา ต้องติ๊กเลือกสาขานั้น ๆ ให้ครบ</li>
            <li><strong>การแก้ไขขอบเขตจะแทนที่ของเดิมทั้งหมด</strong> เมื่อบันทึก ระบบจะยึดตามสาขาที่ติ๊กไว้ในหน้าต่างล่าสุดเป็นหลัก (สาขาที่เคยเลือกไว้แต่ไม่ได้ติ๊กในรอบนี้จะถูกถอดออก)</li>
            <li><strong>ปิดใช้งานไม่ใช่การลบ</strong> การกด &quot;ปิดใช้งาน&quot; เพียงหยุดแสดงต่อพนักงาน ข้อมูลประกาศและประวัติการรับทราบยังคงอยู่ในระบบ (หน้านี้ไม่มีปุ่มลบประกาศ)</li>
            <li><strong>ยอด &quot;รับทราบแล้ว&quot; นับเฉพาะคนที่กดรับทราบจริง</strong> ไม่นับคนที่แค่เปิดดูหรือกด &quot;ภายหลัง&quot; (เลื่อนไปเตือนอีกครั้งในวันถัดไป)</li>
            <li>หากบันทึกไม่สำเร็จ ระบบจะแจ้ง <strong>บันทึกไม่สำเร็จ</strong> ให้ตรวจสอบการเชื่อมต่อและลองใหม่อีกครั้ง</li>
            <li>หน้านี้ใช้ได้เฉพาะผู้มีสิทธิ์จัดการงานบุคคลเท่านั้น</li>
          </ul>
        </WarnBox>
      </Card>
    </>
  );
}
