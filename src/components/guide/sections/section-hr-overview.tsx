import { Card, CardTitle, CardSubtitle, Step, TipBox, WarnBox, TableWrap, Th, Td, ManualImg } from '../manual-ui';

export function SectionHrOverview() {
  return (
    <>
      {/* ── ใครเข้าโมดูล HR ได้บ้าง ── */}
      <Card>
        <CardTitle icon="🔑">ใครเข้าโมดูล HR ได้บ้าง</CardTitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>เจ้าของ (owner)</strong> เข้าได้ทันทีทุกหน้า</li>
          <li>
            <strong>ผู้ใช้อื่น</strong> ต้องได้รับสิทธิ์ <strong>&quot;จัดการงานบุคคล (can_manage_hr)&quot;</strong> ก่อน
            โดยเจ้าของเป็นคนมอบสิทธิ์ให้ที่เมนู <strong>ผู้ใช้ &rarr; เลือกรายชื่อ &rarr; สิทธิ์การใช้งาน</strong>{' '}
            (<code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/users/[id]/permissions</code>)
          </li>
          <li>ถ้าไม่มีสิทธิ์ ระบบจะเด้งกลับหน้าแรกโดยอัตโนมัติ แม้จะพิมพ์ URL ตรงก็ตาม</li>
        </ul>
      </Card>

      {/* ── วิธีเข้าโมดูล HR ── */}
      <Card>
        <CardTitle icon="🚪">วิธีเข้าโมดูล HR</CardTitle>
        <Step num={1} title="เข้าสู่ระบบ Davis-Inventory ตามปกติ">
          <p>ล็อกอินด้วยบัญชีของคุณ</p>
        </Step>
        <Step num={2} title="เปิดการ์ดโมดูล บุคคล (HR)">
          <p>ที่แดชบอร์ดหลัก มองหากลุ่มโมดูล &quot;บุคคล (HR)&quot; แล้วกดการ์ดโมดูล <strong>บุคคล (HR)</strong> (ไอคอนรูปคน สีเขียวอมฟ้า)</p>
        </Step>
        <Step num={3} title="เข้าสู่ศูนย์รวมเมนู HR">
          <p>
            ระบบจะพาไปหน้า <strong>ศูนย์รวมเมนู HR</strong>{' '}
            (<code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr</code>){' '}
            ซึ่งเป็นตารางการ์ด (tile) ของทุกเมนูในโมดูล — กดการ์ดใดก็ได้เพื่อเข้าหน้านั้น
          </p>
        </Step>
        <ManualImg name="hr-home-01-module-tile.png" desc="การ์ดโมดูล บุคคล (HR) บนแดชบอร์ดหลัก" />
        <ManualImg name="hr-home-02-hub.png" desc="หน้าศูนย์รวมเมนู HR (/hr) แสดงการ์ดเมนูทั้งหมด" />
      </Card>

      {/* ── เมนูทั้งหมดในโมดูล HR ── */}
      <Card>
        <CardTitle icon="🗂️">เมนูทั้งหมดในโมดูล HR</CardTitle>
        <TableWrap>
          <thead>
            <tr><Th>กลุ่ม</Th><Th>เมนู (ชื่อในระบบ)</Th><Th>เส้นทาง</Th></tr>
          </thead>
          <tbody>
            <tr><Td>ภาพรวม</Td><Td>แดชบอร์ดวันนี้</Td><Td><code className="text-xs">/hr/dashboard</code></Td></tr>
            <tr><Td>ข้อมูลพนักงาน</Td><Td>พนักงาน</Td><Td><code className="text-xs">/hr/employees</code></Td></tr>
            <tr><Td>ข้อมูลพนักงาน</Td><Td>ยืนยันตัวตนพนักงาน</Td><Td><code className="text-xs">/hr/identity-claims</code></Td></tr>
            <tr><Td>โครงสร้างองค์กร</Td><Td>ตำแหน่ง &amp; แผนก</Td><Td><code className="text-xs">/hr/org</code></Td></tr>
            <tr><Td>โครงสร้างองค์กร</Td><Td>ผังองค์กร</Td><Td><code className="text-xs">/hr/org-chart</code></Td></tr>
            <tr><Td>โครงสร้างองค์กร</Td><Td>บริษัท &amp; กติกาเงินเดือน</Td><Td><code className="text-xs">/hr/companies</code></Td></tr>
            <tr><Td>โครงสร้างองค์กร</Td><Td>กติกา &amp; นโยบาย</Td><Td><code className="text-xs">/hr/policy-settings</code></Td></tr>
            <tr><Td>เวลาทำงาน</Td><Td>ลงเวลา</Td><Td><code className="text-xs">/hr/attendance</code></Td></tr>
            <tr><Td>เวลาทำงาน</Td><Td>จุด/สาขาสำหรับลงเวลา</Td><Td><code className="text-xs">/hr/locations</code></Td></tr>
            <tr><Td>เวลาทำงาน</Td><Td>ตารางงาน</Td><Td><code className="text-xs">/hr/schedule</code></Td></tr>
            <tr><Td>เวลาทำงาน</Td><Td>บันทึกเวลา</Td><Td><code className="text-xs">/hr/timesheet</code></Td></tr>
            <tr><Td>คำขอจากพนักงาน</Td><Td>สลับวันหยุด</Td><Td><code className="text-xs">/hr/swaps</code></Td></tr>
            <tr><Td>คำขอจากพนักงาน</Td><Td>คำขอ (OT/แก้เวลา)</Td><Td><code className="text-xs">/hr/requests</code></Td></tr>
            <tr><Td>คำขอจากพนักงาน</Td><Td>การลา</Td><Td><code className="text-xs">/hr/leaves</code></Td></tr>
            <tr><Td>คำขอจากพนักงาน</Td><Td>ประเภทการลา/วันหยุด</Td><Td><code className="text-xs">/hr/leave-types</code></Td></tr>
            <tr><Td>วินัยและคำขออื่น</Td><Td>ใบเตือน</Td><Td><code className="text-xs">/hr/warnings</code></Td></tr>
            <tr><Td>วินัยและคำขออื่น</Td><Td>เบิกค่าใช้จ่าย</Td><Td><code className="text-xs">/hr/claims</code></Td></tr>
            <tr><Td>วินัยและคำขออื่น</Td><Td>คำขอแก้ไขข้อมูล</Td><Td><code className="text-xs">/hr/profile-requests</code></Td></tr>
            <tr><Td>วินัยและคำขออื่น</Td><Td>การพ้นสภาพ</Td><Td><code className="text-xs">/hr/offboarding</code></Td></tr>
            <tr><Td>เงินเดือน</Td><Td>เงินเดือน</Td><Td><code className="text-xs">/hr/payroll</code></Td></tr>
            <tr><Td>เงินเดือน</Td><Td>เปรียบเทียบเงินเดือนระหว่างงวด</Td><Td><code className="text-xs">/hr/payroll/compare</code></Td></tr>
            <tr><Td>เอกสาร</Td><Td>คำขอเอกสาร/50ทวิ</Td><Td><code className="text-xs">/hr/document-requests</code></Td></tr>
            <tr><Td>เอกสาร</Td><Td>หนังสือรับรอง</Td><Td><code className="text-xs">/hr/certificates</code></Td></tr>
            <tr><Td>เงินพิเศษ</Td><Td>เซอร์วิสชาร์จ</Td><Td><code className="text-xs">/hr/service-charge</code></Td></tr>
            <tr><Td>เงินพิเศษ</Td><Td>กองทุนทิป</Td><Td><code className="text-xs">/hr/tip-pool</code></Td></tr>
            <tr><Td>ประเมินผล</Td><Td>ประเมินผล</Td><Td><code className="text-xs">/hr/evaluation</code></Td></tr>
            <tr><Td>ทรัพย์สินและสื่อสาร</Td><Td>ทรัพย์สิน</Td><Td><code className="text-xs">/hr/assets</code></Td></tr>
            <tr><Td>ทรัพย์สินและสื่อสาร</Td><Td>นโยบาย</Td><Td><code className="text-xs">/hr/policies</code></Td></tr>
            <tr><Td>ทรัพย์สินและสื่อสาร</Td><Td>ประกาศ</Td><Td><code className="text-xs">/hr/announcements</code></Td></tr>
            <tr><Td>ตรวจสอบ</Td><Td>บันทึกการตรวจสอบ</Td><Td><code className="text-xs">/hr/audit</code></Td></tr>
            <tr><Td>ตรวจสอบ</Td><Td>รายงาน</Td><Td><code className="text-xs">/hr/reports</code></Td></tr>
          </tbody>
        </TableWrap>
      </Card>

      {/* ── ฝั่งพนักงาน (ESS) ── */}
      <Card>
        <CardTitle icon="🔄">ฝั่งพนักงาน (ESS) เกี่ยวข้องกับ HR อย่างไร</CardTitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          พนักงานทุกคน (ทุกบทบาท) มีโมดูล <strong>&quot;ของฉัน&quot;</strong>{' '}
          (<code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/me</code>){' '}
          ไว้จัดการงานบุคคลของตัวเอง เช่น เช็คอินเข้างาน ดูตารางงาน ยื่นลา ขอ OT ดูสลิปเงินเดือน ฯลฯ
          ข้อมูลและคำขอจากฝั่งพนักงานจะไหลเข้ามารอให้ HR ตรวจ/อนุมัติในเมนูฝั่ง HR ดังนี้
        </p>
        <TableWrap>
          <thead>
            <tr><Th>พนักงานทำที่ (ของฉัน)</Th><Th>มารอ HR ที่เมนู</Th></tr>
          </thead>
          <tbody>
            <tr><Td>เช็คอิน–เช็คเอาท์ <code className="text-xs">/me/checkin</code></Td><Td>ลงเวลา <code className="text-xs">/hr/attendance</code> &rarr; บันทึกเวลา <code className="text-xs">/hr/timesheet</code></Td></tr>
            <tr><Td>ยื่นลา <code className="text-xs">/me/leaves</code></Td><Td>การลา <code className="text-xs">/hr/leaves</code></Td></tr>
            <tr><Td>ขอ OT <code className="text-xs">/me/ot-requests</code></Td><Td>คำขอ (OT/แก้เวลา) <code className="text-xs">/hr/requests</code></Td></tr>
            <tr><Td>ขอแก้เวลาเข้า-ออก <code className="text-xs">/me/attendance-requests</code></Td><Td>คำขอ (OT/แก้เวลา) <code className="text-xs">/hr/requests</code></Td></tr>
            <tr><Td>ขอสลับวันหยุด <code className="text-xs">/me/swaps</code></Td><Td>สลับวันหยุด <code className="text-xs">/hr/swaps</code></Td></tr>
            <tr><Td>เบิกค่าใช้จ่าย <code className="text-xs">/me/claims</code></Td><Td>เบิกค่าใช้จ่าย <code className="text-xs">/hr/claims</code></Td></tr>
            <tr><Td>ขอแก้ข้อมูลส่วนตัว <code className="text-xs">/me/profile</code></Td><Td>คำขอแก้ไขข้อมูล <code className="text-xs">/hr/profile-requests</code></Td></tr>
            <tr><Td>ขอเอกสาร/หนังสือรับรอง <code className="text-xs">/me/documents</code></Td><Td>คำขอเอกสาร/50ทวิ <code className="text-xs">/hr/document-requests</code></Td></tr>
          </tbody>
        </TableWrap>

        <CardSubtitle>ผังการไหลของข้อมูลหลักทั้งโมดูล</CardSubtitle>
        <pre className="my-4 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
{`พนักงานเช็คอิน/ยื่นคำขอ (ของฉัน /me)
        ↓
HR ตรวจ/อนุมัติ (ลงเวลา · การลา · คำขอ OT/แก้เวลา · สลับวันหยุด)
        ↓
บันทึกเวลา (/hr/timesheet) สรุปชั่วโมง/ขาด/ลา/มาสาย
        ↓
เงินเดือน (/hr/payroll) คำนวณงวดจ่าย + เซอร์วิสชาร์จ + ทิป + ประเมินผล
        ↓
สลิปเงินเดือนของพนักงาน (/me/payslips) · รายงาน · ไฟล์ธนาคาร · เอกสารภาษี`}
        </pre>
      </Card>

      {/* ══════════ แดชบอร์ดวันนี้ ══════════ */}
      <Card>
        <CardTitle icon="📊">แดชบอร์ดวันนี้</CardTitle>
        <p className="mb-3 text-xs text-gray-400">
          เส้นทาง: <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">/hr/dashboard</code>
        </p>

        <CardSubtitle>หน้านี้ใช้ทำอะไร</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          หน้า &quot;แดชบอร์ด HR&quot; คือหน้าภาพรวมประจำวันของฝ่ายบุคคล ตามคำโปรยบนหน้าจอ
          &quot;ภาพรวมวันนี้และเดือนนี้ — ในความดูแลของคุณ&quot; ใช้ดูว่าวันนี้พนักงานเข้างานกี่คน ลากี่คน
          ยังไม่เข้ากี่คน มาสายกี่คน พร้อมกราฟสัดส่วนการเข้างาน แยกรายสาขา แนวโน้มการเข้างานสะสมทั้งเดือน
          วันลาตามประเภท ตัวเลขสรุปประจำเดือน (พนักงานใหม่ / พ้นสภาพ / ใบเตือน) สถานะเงินเดือนและการประเมินของงวดนี้
          รวมถึง &quot;คิวรออนุมัติ&quot; ที่กดข้ามไปอนุมัติงานแต่ละประเภทได้ทันที
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          นอกจากนี้ยังมีส่วน &quot;แจ้งเตือน HR&quot; ที่มองไปข้างหน้า 14 วัน เตือนเรื่องพนักงานใกล้ครบทดลองงาน
          ครบรอบการทำงาน วันเกิดพนักงาน และเตือนพิเศษกรณีพนักงานประจำที่ผ่านทดลองงานแล้วแต่ยังไม่ได้เข้าประกันสังคม
          และมีปุ่ม &quot;คัดลอกสรุปไปไลน์&quot; สำหรับส่งสรุปรายชื่อประจำวันเข้ากลุ่ม LINE
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          ข้อมูลทั้งหมดแสดง &quot;ตามขอบเขตที่คุณดูแล&quot; — HR ระดับบริษัทเห็นทุกสาขา
          ส่วนผู้จัดการที่ดูแลบางสาขาจะเห็นเฉพาะพนักงานสาขาของตนเอง
        </p>
        <ManualImg name="hr-dashboard-01-overview.png" desc="ภาพรวมหน้าแดชบอร์ด HR ทั้งหน้า" />

        <CardSubtitle>วิธีเข้าหน้านี้</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เข้าเมนูหลักของโมดูล <strong>บุคคล (HR)</strong> ที่หน้า <code className="text-xs">/hr</code> (หน้าตารางไอคอน)</li>
          <li>กดการ์ดชื่อ <strong>แดชบอร์ดวันนี้</strong> ระบบจะพาไปที่ <code className="text-xs">/hr/dashboard</code></li>
        </ol>
      </Card>

      {/* ── ส่วนประกอบบนหน้าจอ ── */}
      <Card>
        <CardTitle icon="🧩">ส่วนประกอบบนหน้าจอ</CardTitle>

        <CardSubtitle>แถบหัวเรื่องและตัวกรอง (ด้านบน)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>หัวเรื่อง &quot;แดชบอร์ด HR&quot; พร้อมคำโปรย &quot;ภาพรวมวันนี้และเดือนนี้ — ในความดูแลของคุณ&quot;</li>
          <li><strong>วันที่</strong> — เลือกวันที่ต้องการดู (ค่าเริ่มต้นคือวันนี้ตามเวลาไทย) เปลี่ยนวันแล้วหน้าจะโหลดข้อมูลใหม่อัตโนมัติ ถ้าเลือกวันในเดือนก่อนหน้า กราฟรายเดือนจะแสดงทั้งเดือนนั้นเต็มเดือน</li>
          <li><strong>สาขา</strong> — รายการเลือกสาขา ค่าเริ่มต้นคือ &quot;ทุกสาขา&quot; รายการสาขาที่เลือกได้มีเฉพาะสาขาที่คุณมีสิทธิ์ดูแล</li>
          <li><strong>รีเฟรช</strong> — โหลดข้อมูลบนหน้าใหม่ทั้งหมดตามวันที่/สาขาที่เลือกอยู่</li>
        </ul>

        <CardSubtitle>หัวข้อ &quot;วันนี้ · (วันที่)&quot; และปุ่มคัดลอก</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>คัดลอกสรุปไปไลน์</strong> — คัดลอกข้อความสรุปประจำวัน (วันที่+สาขา, จำนวนพนักงาน, รายชื่อผู้เข้างาน/ลา/ยังไม่เข้า) เข้าคลิปบอร์ด สำเร็จจะขึ้นข้อความ &quot;คัดลอกแล้ว&quot; ถ้าไม่สำเร็จขึ้น &quot;คัดลอกไม่สำเร็จ&quot; (ข้อความสรุปนี้ไม่รวมจำนวนคนมาสาย)</li>
        </ul>

        <CardSubtitle>การ์ดตัวเลขสรุปวันนี้ 6 ใบ</CardSubtitle>
        <TableWrap>
          <thead>
            <tr><Th>การ์ด</Th><Th>ความหมาย</Th></tr>
          </thead>
          <tbody>
            <tr><Td>พนักงาน</Td><Td>จำนวนพนักงานทั้งหมดในขอบเขต/สาขาที่เลือก</Td></tr>
            <tr><Td>เข้างานแล้ว</Td><Td>จำนวนคนที่ลงเวลาเข้างานแล้ววันนี้</Td></tr>
            <tr><Td>ลา</Td><Td>จำนวนคนที่ลาวันนี้ (ลาที่อนุมัติแล้ว)</Td></tr>
            <tr><Td>ยังไม่เข้า</Td><Td>จำนวนคนที่ยังไม่ลงเวลาและไม่ได้ลา</Td></tr>
            <tr><Td>มาสาย</Td><Td>จำนวนคนที่เข้างานสายวันนี้</Td></tr>
            <tr><Td>รออนุมัติ</Td><Td>ผลรวมงานค้างอนุมัติทุกประเภท (ลา + โอที + แก้เวลา + เบิกค่าใช้จ่าย + แก้ข้อมูลส่วนตัว)</Td></tr>
          </tbody>
        </TableWrap>

        <CardSubtitle>กราฟส่วน &quot;วันนี้&quot;</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>สัดส่วนการเข้างานวันนี้</strong> — กราฟวงกลม (โดนัท) ตรงกลางแสดงเปอร์เซ็นต์ผู้เข้างาน สีเขียว = เข้างานแล้ว, สีเหลือง = ลา, สีแดง = ยังไม่เข้า พร้อมตัวเลขกำกับใต้กราฟ</li>
          <li><strong>แบ่งตามสาขา (วันนี้)</strong> — กราฟแท่งแนวนอนรายสาขา (แสดงเฉพาะเมื่อมีข้อมูลรายสาขา) มีคำใบ้ &quot;แตะแถบเพื่อกรองสาขา&quot;: คลิกแท่งของสาขาใดจะเป็นการเลือกกรองสาขานั้นทั้งหน้า คลิกซ้ำที่สาขาเดิมเพื่อกลับมาดูทุกสาขา ตัวเลขท้ายแท่งคือจำนวนพนักงานของสาขานั้น</li>
        </ul>

        <CardSubtitle>กล่องรายชื่อ 3 กล่อง</CardSubtitle>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          รายชื่อจริงของพนักงานแต่ละกลุ่มในวันที่เลือก: <strong>เข้างานแล้ว</strong> (สีเขียว),{' '}
          <strong>ลา</strong> (สีเหลือง), <strong>ยังไม่เข้า</strong> (สีแดง)
          มุมขวาของแต่ละกล่องแสดงจำนวนคน ถ้าไม่มีใครจะแสดง &quot;—&quot;
        </p>

        <CardSubtitle>หัวข้อ &quot;เดือนนี้ · (เดือน)&quot;</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>การเข้างานรายวัน (สะสมทั้งเดือน)</strong> — กราฟเส้น 2 เส้น: จำนวนผู้เข้างานต่อวัน (สีน้ำเงิน) และจำนวนคนมาสายต่อวัน (สีส้ม)</li>
          <li><strong>การ์ดตัวนับ 3 ช่อง</strong>: <strong>พนักงานใหม่</strong> (เริ่มงานเดือนนี้), <strong>พ้นสภาพ</strong> (ออกเดือนนี้), <strong>ใบเตือน</strong> (ออกเดือนนี้)</li>
          <li>
            <strong>การ์ด &quot;เงินเดือนงวดนี้&quot;</strong> — สรุปรอบเงินเดือนของงวดนี้ในรูปแบบ &quot;X/Y ปิดงวดแล้ว · Z สลิป&quot; พร้อมยอด <strong>สุทธิรวม</strong> เป็นเงินบาท กดที่การ์ดเพื่อไปหน้า <code className="text-xs">/hr/payroll</code> ได้เลย
            <ul className="mt-1.5 ml-5 list-disc space-y-1">
              <li>ถ้ายังไม่มีรอบเงินเดือน จะแสดง &quot;ยังไม่สร้างรอบเงินเดือน&quot; (ยังกดไปหน้าเงินเดือนได้)</li>
              <li>ถ้าคุณเป็นผู้จัดการระดับสาขาและจำนวนสลิปน้อยกว่า 3 ใบ ระบบจะแสดง &quot;ซ่อนยอดสุทธิ (ความเป็นส่วนตัว)&quot; แทนยอดเงิน เพื่อไม่ให้เดาเงินเดือนรายบุคคลได้</li>
            </ul>
          </li>
          <li><strong>การ์ด &quot;การประเมินเดือนนี้&quot;</strong> — แสดงเฉพาะ HR ระดับบริษัท และเฉพาะเมื่อมีรอบประเมินของเดือนนี้อยู่แล้วเท่านั้น (ถ้ายังไม่มีรอบประเมิน การ์ดนี้จะไม่ปรากฏเลย) แสดงความคืบหน้า &quot;ส่งแล้ว X/Y&quot; พร้อมแถบเปอร์เซ็นต์ กดเพื่อไปหน้า <code className="text-xs">/hr/evaluation</code></li>
          <li><strong>การ์ด &quot;วันลาตามประเภท&quot;</strong> — กราฟแท่งจำนวนวันลาแยกตามประเภทการลาของเดือนนี้ ถ้าไม่มีเลยแสดง &quot;ไม่มีวันลาเดือนนี้&quot;</li>
          <li>
            <strong>การ์ด &quot;คิวรออนุมัติ&quot;</strong> — รายการงานค้างอนุมัติพร้อมตัวเลข (ตัวเลขเป็นสีน้ำเงินเมื่อมีงานค้าง, สีเทาเมื่อเป็น 0) กดแต่ละแถวเพื่อข้ามไปหน้าอนุมัติจริง:
            <ul className="mt-1.5 ml-5 list-disc space-y-1">
              <li><strong>คำขอลา</strong> &rarr; <code className="text-xs">/hr/leaves</code></li>
              <li><strong>ขอโอที</strong> &rarr; <code className="text-xs">/hr/requests</code></li>
              <li><strong>ขอแก้เวลา</strong> &rarr; <code className="text-xs">/hr/requests</code></li>
              <li><strong>เบิกค่าใช้จ่าย</strong> &rarr; <code className="text-xs">/hr/claims</code></li>
              <li><strong>แก้ข้อมูลส่วนตัว</strong> &rarr; <code className="text-xs">/hr/profile-requests</code> (แถวนี้แสดงเฉพาะ HR ระดับบริษัทที่ดูแบบ &quot;ทุกสาขา&quot;)</li>
            </ul>
          </li>
        </ul>
        <ManualImg name="hr-dashboard-02-today-charts.png" desc="กราฟสัดส่วนการเข้างานและแบ่งตามสาขา" />
        <ManualImg name="hr-dashboard-03-month-section.png" desc="ส่วนเดือนนี้: เงินเดือน ประเมินผล และคิวรออนุมัติ" />

        <CardSubtitle>ส่วน &quot;แจ้งเตือน HR&quot; (ล่างสุด — แสดงเฉพาะเมื่อมีรายการ)</CardSubtitle>
        <ul className="mb-3 ml-5 list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li><strong>ครบทดลองงานแล้ว ยังไม่เข้าประกันสังคม</strong> (กรอบสีแดงชมพู) — พนักงานประจำรายเดือนที่ผ่านวันครบทดลองงานแล้วแต่ยังไม่ถูกติ๊กว่าเข้าประกันสังคม แสดงชื่อ วันที่ครบทดลองงาน และ &quot;เกินมา X วัน&quot; (หรือ &quot;ครบวันนี้&quot;) พร้อมคำแนะนำบนการ์ด: &quot;ขึ้นทะเบียน สปส. แล้วติ๊ก &lsquo;เข้าประกันสังคม&rsquo; ในโปรไฟล์พนักงาน&quot; — การแจ้งเตือนนี้จะค้างอยู่จนกว่า HR จะไปติ๊กในหน้าโปรไฟล์พนักงาน (พนักงานพาร์ทไทม์ไม่ถูกนับ)</li>
          <li><strong>ครบทดลองงาน</strong> (กรอบสีเหลือง) — พนักงานสถานะทดลองงานที่จะครบกำหนดภายใน 14 วันข้างหน้า แสดงชื่อ วันที่ครบ และ &quot;อีก X วัน&quot; (หรือ &quot;วันนี้&quot;)</li>
          <li><strong>ครบรอบงาน</strong> (กรอบสีม่วง) — พนักงานที่จะครบรอบปีการทำงานภายใน 14 วัน แสดงชื่อ จำนวนปี (เช่น &quot;3 ปี&quot;) และ &quot;อีก X วัน&quot;</li>
          <li><strong>วันเกิดพนักงาน</strong> (กรอบสีชมพู) — พนักงานที่จะมีวันเกิดภายใน 14 วัน แสดงชื่อ วัน/เดือนเกิด (ไม่แสดงปีเกิด) และ &quot;อีก X วัน&quot;</li>
        </ul>
        <ManualImg name="hr-dashboard-04-alerts.png" desc="ส่วนแจ้งเตือน HR: ประกันสังคม ครบทดลองงาน ครบรอบงาน วันเกิด" />
      </Card>

      {/* ── ขั้นตอนการทำงาน ── */}
      <Card>
        <CardTitle icon="🛠️">ขั้นตอนการทำงาน</CardTitle>

        <CardSubtitle>ดูภาพรวมประจำวัน (งานเช้าประจำ)</CardSubtitle>
        <Step num={1} title="เข้าเมนู บุคคล (HR) → แดชบอร์ดวันนี้">
          <p>เปิดหน้าแดชบอร์ดจากศูนย์รวมเมนู HR</p>
        </Step>
        <Step num={2} title="รอหน้าโหลดข้อมูลวันนี้">
          <p>หน้าจะโหลดข้อมูลของทุกสาขาที่คุณดูแลโดยอัตโนมัติ</p>
        </Step>
        <Step num={3} title="เช็กภาพรวมและกล่องรายชื่อ">
          <p>ดูการ์ด 6 ใบด้านบนเพื่อเช็กภาพรวม แล้วเลื่อนดูกล่องรายชื่อ &quot;ยังไม่เข้า&quot; ว่ามีใครหายไปบ้าง</p>
        </Step>
        <Step num={4} title="เจาะรายสาขา (ถ้าต้องการ)">
          <p>เลือกจากช่อง <strong>สาขา</strong> หรือคลิกแท่งสาขาในกราฟ &quot;แบ่งตามสาขา (วันนี้)&quot;</p>
        </Step>

        <CardSubtitle>ส่งสรุปประจำวันเข้ากลุ่ม LINE</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เลือกวันที่และสาขาที่ต้องการ</li>
          <li>กดปุ่ม <strong>คัดลอกสรุปไปไลน์</strong> — เมื่อขึ้น &quot;คัดลอกแล้ว&quot; ข้อความสรุป (จำนวนพนักงาน + รายชื่อเข้างาน/ลา/ยังไม่เข้า) จะอยู่ในคลิปบอร์ด</li>
          <li>เปิดแอป LINE แล้ววาง (Paste) ในห้องแชทที่ต้องการ</li>
        </ol>

        <CardSubtitle>ดูข้อมูลย้อนหลัง</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เปลี่ยนช่อง <strong>วันที่</strong> เป็นวันที่ต้องการ ระบบโหลดใหม่อัตโนมัติ</li>
          <li>ส่วน &quot;เดือนนี้&quot; จะเปลี่ยนตามเดือนของวันที่ที่เลือก — ถ้าเป็นเดือนที่ผ่านมาแล้วจะเห็นกราฟทั้งเดือน</li>
        </ol>

        <CardSubtitle>เคลียร์งานค้างอนุมัติ</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>ดูการ์ด <strong>คิวรออนุมัติ</strong> — แถวไหนตัวเลขเป็นสีน้ำเงิน (มากกว่า 0) คือมีงานรอ</li>
          <li>กดแถวนั้นเพื่อไปหน้าอนุมัติจริง (เช่น กด &quot;คำขอลา&quot; ไปหน้า การลา) แล้วอนุมัติ/ปฏิเสธที่หน้านั้น</li>
          <li>กลับมาหน้าแดชบอร์ดแล้วกด <strong>รีเฟรช</strong> ตัวเลขจะลดลงตามงานที่เคลียร์แล้ว</li>
        </ol>

        <CardSubtitle>จัดการแจ้งเตือนประกันสังคม</CardSubtitle>
        <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <li>เมื่อเห็นชื่อพนักงานในการ์ด &quot;ครบทดลองงานแล้ว ยังไม่เข้าประกันสังคม&quot; ให้ไปขึ้นทะเบียนพนักงานกับสำนักงานประกันสังคม (สปส.) ตามขั้นตอนปกติก่อน</li>
          <li>จากนั้นเข้าหน้า พนักงาน (<code className="text-xs">/hr/employees</code>) เปิดโปรไฟล์พนักงานคนนั้น แล้วติ๊กช่อง &quot;เข้าประกันสังคม&quot;</li>
          <li>การแจ้งเตือนของคนนั้นจะหายไปจากแดชบอร์ด (ระบบตั้งใจไม่ติ๊กให้อัตโนมัติ เพราะต้องทำเอกสารจริงก่อน)</li>
        </ol>
      </Card>

      {/* ── เชื่อมโยงกับหน้าอื่น ── */}
      <Card>
        <CardTitle icon="🔗">เชื่อมโยงกับหน้าอื่น</CardTitle>
        <TableWrap>
          <thead>
            <tr><Th>หน้า</Th><Th>เมนู (ไทย)</Th><Th>ความเกี่ยวข้อง</Th></tr>
          </thead>
          <tbody>
            <tr><Td><code className="text-xs">/hr</code></Td><Td>บุคคล (HR)</Td><Td>เมนูหลัก — ทางเข้าหน้านี้ผ่านการ์ด &quot;แดชบอร์ดวันนี้&quot;</Td></tr>
            <tr><Td><code className="text-xs">/hr/leaves</code></Td><Td>การลา</Td><Td>คำขอลาที่พนักงานยื่นมารอนับใน &quot;คิวรออนุมัติ &rarr; คำขอลา&quot; กดแล้วไปอนุมัติที่หน้านี้ วันลาที่อนุมัติแล้วจะสะท้อนในการ์ด &quot;ลา&quot; และกราฟ &quot;วันลาตามประเภท&quot;</Td></tr>
            <tr><Td><code className="text-xs">/hr/requests</code></Td><Td>คำขอ</Td><Td>ที่อนุมัติ &quot;ขอโอที&quot; และ &quot;ขอแก้เวลา&quot; ที่ค้างอยู่ในคิว</Td></tr>
            <tr><Td><code className="text-xs">/hr/claims</code></Td><Td>เบิกค่าใช้จ่าย</Td><Td>ที่อนุมัติรายการ &quot;เบิกค่าใช้จ่าย&quot; ที่ค้างอยู่ในคิว</Td></tr>
            <tr><Td><code className="text-xs">/hr/profile-requests</code></Td><Td>คำขอแก้ไขข้อมูล</Td><Td>ที่อนุมัติ &quot;แก้ข้อมูลส่วนตัว&quot; (เฉพาะ HR ระดับบริษัท)</Td></tr>
            <tr><Td><code className="text-xs">/hr/payroll</code></Td><Td>เงินเดือน</Td><Td>การ์ด &quot;เงินเดือนงวดนี้&quot; กดแล้วมาหน้านี้ — จำนวนรอบ/สลิป/ยอดสุทธิบนแดชบอร์ดมาจากรอบเงินเดือนที่สร้างที่นี่</Td></tr>
            <tr><Td><code className="text-xs">/hr/evaluation</code></Td><Td>ประเมินผล</Td><Td>การ์ด &quot;การประเมินเดือนนี้&quot; กดแล้วมาหน้านี้ — ความคืบหน้าการส่งแบบประเมินแสดงบนแดชบอร์ด</Td></tr>
            <tr><Td><code className="text-xs">/hr/employees</code></Td><Td>พนักงาน</Td><Td>ที่ติ๊ก &quot;เข้าประกันสังคม&quot; เพื่อปิดแจ้งเตือน SSO และเป็นแหล่งข้อมูลวันเริ่มงาน/วันครบทดลองงาน/วันเกิดที่ใช้สร้างแจ้งเตือน</Td></tr>
            <tr><Td><code className="text-xs">/hr/attendance</code></Td><Td>ลงเวลา</Td><Td>การลงเวลาเข้า-ออกของพนักงานคือข้อมูลต้นทางของการ์ด &quot;เข้างานแล้ว / ยังไม่เข้า / มาสาย&quot; และกราฟทั้งหมด</Td></tr>
            <tr><Td><code className="text-xs">/hr/warnings</code></Td><Td>ใบเตือน</Td><Td>จำนวน &quot;ใบเตือน&quot; ในตัวนับประจำเดือนมาจากใบเตือนที่ออกในหน้านี้</Td></tr>
            <tr><Td><code className="text-xs">/hr/offboarding</code></Td><Td>การพ้นสภาพ</Td><Td>ตัวนับ &quot;พ้นสภาพ&quot; ประจำเดือนมาจากการดำเนินการที่หน้านี้</Td></tr>
          </tbody>
        </TableWrap>
      </Card>

      {/* ── หมายเหตุ/ข้อควรระวัง ── */}
      <Card>
        <CardTitle icon="⚠️">หมายเหตุ/ข้อควรระวัง</CardTitle>
        <WarnBox>
          <ul className="ml-4 list-disc space-y-1.5">
            <li><strong>สิทธิ์การเข้าถึง</strong>: หน้านี้เป็นหน้าฝ่ายบุคคล/ผู้จัดการ ข้อมูลถูกจำกัดตามขอบเขตอัตโนมัติ — HR ระดับบริษัทเห็นทุกสาขา ผู้จัดการเห็นเฉพาะสาขาที่ตนดูแล ถ้าพยายามเลือกสาขานอกขอบเขตระบบจะปฏิเสธ</li>
            <li>แถว <strong>แก้ข้อมูลส่วนตัว</strong>, การ์ด <strong>การประเมินเดือนนี้</strong> และบางข้อมูลระดับบริษัท จะแสดงเฉพาะ HR ระดับบริษัทที่ดูแบบ &quot;ทุกสาขา&quot; — ผู้จัดการสาขาจะไม่เห็นส่วนเหล่านี้ ซึ่งเป็นเรื่องปกติ ไม่ใช่ข้อผิดพลาด</li>
            <li>ยอด <strong>สุทธิรวม</strong> ของเงินเดือนอาจถูกซ่อนเป็น &quot;ซ่อนยอดสุทธิ (ความเป็นส่วนตัว)&quot; เมื่อผู้ดูเป็นระดับสาขาและจำนวนสลิปน้อยกว่า 3 ใบ เพื่อป้องกันการเดาเงินเดือนรายบุคคล</li>
            <li>หน้านี้เป็นหน้า <strong>อ่านอย่างเดียว</strong> — ไม่มีการอนุมัติ/แก้ไขข้อมูลบนหน้านี้โดยตรง ทุกการกระทำจะพาไปทำที่หน้าปลายทาง</li>
            <li>วันที่ใช้ <strong>เวลาประเทศไทย (Bangkok)</strong> เป็นเกณฑ์ ค่าเริ่มต้นคือวันนี้เสมอ</li>
          </ul>
        </WarnBox>
        <TipBox>
          <ul className="ml-4 list-disc space-y-1.5">
            <li>ส่วน &quot;แจ้งเตือน HR&quot; มองล่วงหน้า <strong>14 วัน</strong> และจะซ่อนทั้งส่วนถ้าไม่มีรายการใดเลย ทั้งนี้แจ้งเตือนจะกรองตามสาขาที่เลือกด้วย</li>
            <li>แจ้งเตือนประกันสังคม <strong>ไม่มีวันหมดอายุ</strong> — จะเตือนค้างไว้จนกว่าจะติ๊ก &quot;เข้าประกันสังคม&quot; ในโปรไฟล์พนักงาน</li>
            <li>หากโหลดข้อมูลไม่สำเร็จจะขึ้นข้อความ &quot;โหลดไม่สำเร็จ&quot; — ลองกดปุ่ม <strong>รีเฟรช</strong> อีกครั้ง หรือตรวจสอบการเชื่อมต่ออินเทอร์เน็ต</li>
            <li>ปุ่ม &quot;คัดลอกสรุปไปไลน์&quot; ใช้คลิปบอร์ดของเบราว์เซอร์ — บางเบราว์เซอร์อาจถามสิทธิ์ก่อน ถ้าถูกปฏิเสธจะขึ้น &quot;คัดลอกไม่สำเร็จ&quot;</li>
          </ul>
        </TipBox>
      </Card>
    </>
  );
}
