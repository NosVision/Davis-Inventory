# HR Build — State Tracker

> loop อ่านไฟล์นี้ก่อนเริ่มทุกครั้ง · ติ๊ก [x] เมื่อ e2e ผ่าน + typecheck เขียว + commit local แล้วเท่านั้น
> อัปเดตล่าสุด: 2026-07-02 (ยังไม่เริ่ม — สร้างไฟล์)

## สถานะรวม
- เฟสปัจจุบัน: **P0 (ยังไม่เริ่ม)**
- dev server: localhost:3000 · Supabase: oogyjqywuqmutkjnnsik (live)
- test creds: (จะอยู่ที่ scratchpad `hr-test-creds.json` หลัง P0.4 — ห้าม commit)
- handoff ล่าสุด: (path จะถูกจดที่นี่ทุกจบรอบ)

## P0 — ฐานราก
- [ ] P0.1 reconcile migrations (backfill 00075/00076 + lock เลขถัดไป)
- [ ] P0.2 core tables: hr_companies / hr_positions(seed16) / hr_departments / hr_employees / hr_audit_log / hr_manager_scopes (+RLS ครบ, verify SQL)
- [ ] P0.3 permission can_manage_hr + โมดูล hr ใน registry + โครง /hr + i18n hr + lib/hr/audit.ts
- [ ] P0.4 test users 6 บัญชี + e2e login/เมนู + commit
- [ ] P0 gate: review-agent ผ่าน

## P1 — คน & นโยบาย
- [ ] P1.1 ทะเบียนพนักงาน (list/create/edit + part-time auto-profile + ย้ายบริษัท)
- [ ] P1.2 positions/departments CRUD + หน้า audit log
- [ ] P1.3 policies + announcements (ไม่รับทราบ→เด้งซ้ำ)
- [ ] P1.4 assets
- [ ] P1 e2e ครบ + gate review

## P2 — เวลา
- [ ] P2.1 locations + เช็คอิน GPS+selfie+ลายน้ำ+กัน VPN + dev bypass กล้อง
- [ ] P2.2 ตารางงาน (ผจก.จัด→HR รับทราบ + แผงสมดุล) + ESS ตารางของฉัน
- [ ] P2.3 สลับวันหยุด (ผู้อนุมัติต่อร้าน) + เอนจินเวลา (สาย/ขาด/OT/พัก)
- [ ] P2.4 hr_ot_requests + hr_attendance_requests + timesheet ต่อคน
- [ ] P2 e2e ครบ + gate review

## P3 — คำขอ & วินัย
- [ ] P3.1 เอนจินลา + hr_holidays(13) + ผลการลา 3 ช่องตาม §H
- [ ] P3.2 ใบเตือน (วาจา/25/50/100/200%/บาท + เซ็น 3 ฝ่าย + หักงวดถัดไปทันที)
- [ ] P3.3 eClaims
- [ ] P3.4 ESS แก้ข้อมูล + offboarding
- [ ] P3 e2e ครบ + gate review

## P4 — เงิน
- [ ] P4.1 SC pool กรอกมือ + allocation แก้ได้ + หักอัตโนมัติ (ใบเตือน/ลา/สายซ้ำ) + จ่าย 15
- [ ] P4.2 payroll engine ครบสูตร §A (÷30, OT divisor ต่อคน, SSO 875, tax 3 โหมด, part-time 3 แบบ, หักลาห้าม override)
- [ ] P4.3 payrun flow + สลิปพิมพ์ 9×5.5 itemized + หัวบริษัทตามสังกัด
- [ ] P4 e2e เทียบตัวเลขมือเป๊ะทุกเคส + gate review
- expected values file: (จดพาธเมื่อสร้าง)

## P5 — ประเมิน & รายงาน & แดชบอร์ด
- [ ] P5.1 เอนจินประเมินครบ + tier ติดลบเสียบ SC + คะแนนแยกไม่เปิดชื่อ
- [ ] P5.2 ภงด.1/1ก + 50ทวิ + สปส.1-10 + e-filing + หนังสือรับรอง PDF
- [ ] P5.3 แดชบอร์ด HR/ผจก.(copy ไลน์)/Staff
- [ ] P5 e2e ครบ + security review + build เขียว
- [ ] สรุปรายงานรวมให้เจ้าของ (รอสั่ง push)

## Open questions / assumptions ระหว่างทาง
- (ตั้งต้น) ยอดหัก SC ต่อวันลา = สัดส่วน ÷30 ของ SC เดือนนั้น — configurable
- (ตั้งต้น) part-time รายเดือน = ไม่มีใบเตือนเหมือน part-time อื่น

## Log ต่อรอบ (รอบละบรรทัด: วันที่ · ทำอะไร · commit hash)
- (ยังไม่เริ่ม)
