# HR Build — State Tracker

> loop อ่านไฟล์นี้ก่อนเริ่มทุกครั้ง · ติ๊ก [x] เมื่อ e2e ผ่าน + typecheck เขียว + commit local แล้วเท่านั้น
> อัปเดตล่าสุด: 2026-07-02 (จบ Round 2 — P0.3 + P0.4 เสร็จ, e2e ผ่าน)

## สถานะรวม
- เฟสปัจจุบัน: **P0 (เกือบจบ — เหลือปิด gate review) → ถัดไป P1**
- dev server: localhost:3000 (UP) · Supabase: oogyjqywuqmutkjnnsik (live)
- **เลขไมเกรชันถัดไป = 00078** (00077_hr_core applied+verified)
- test creds: `f:\tmp\hr-test-creds.json` (6 บัญชี hr-test-* + test venue store_code=HRTEST · re-seed ได้ด้วย `node scripts/seed-hr-test-users.mjs`) — ห้าม commit
- handoff ล่าสุด: `f:\tmp\hr-handoff-latest.md`

## P0 — ฐานราก
- [x] P0.1 reconcile migrations — next=00078, ไม่มี hr_* system tables เดิม, drift เก่าไม่บล็อก (2b455b2)
- [x] P0.2 core tables: hr_companies / hr_positions(seed16 ✓) / hr_departments / hr_employees / hr_audit_log / hr_manager_scopes — RLS 12 policies, verify SQL ✓, advisor clean สำหรับ hr_* (2b455b2)
- [x] P0.3 can_manage_hr (4 sync points: type union + permissions route + i18n + registry) + โมดูล hr (กลุ่ม moduleGroups.hr) + /hr dashboard skeleton (12 tiles) + i18n `hr` namespace th/en + lib/hr/audit.ts (logHrAudit → hr_audit_log) — typecheck เขียว
- [x] P0.4 test users 6 บัญชี (owner/hr+can_manage_hr/manager/staff8+1/staff9+1/parttime) + hr_employees time profiles + e2e chrome MCP: owner เห็น HR+เปิด /hr / staff ไม่เห็น / hr(perm) เห็น — ผ่านทั้ง desktop 1440 + mobile 390
- [ ] P0 gate: review-agent (กำลังรีวิว)

## P1 — คน & นโยบาย
- [ ] P1.1 ทะเบียนพนักงาน (list/create/edit + part-time auto-profile + ย้ายบริษัท)
- [ ] P1.2 positions/departments CRUD + หน้า audit log
- [ ] P1.3 policies + announcements (ไม่รับทราบ→เด้งซ้ำ)
- [ ] P1.4 assets
- [ ] P1.5 (Addendum A) org chart + view ประวัติปรับเงินเดือน/ตำแหน่ง + แจ้งเตือนครบทดลองงาน 119 วัน + วันเกิด/ครบรอบงาน + ปุ่มพิมพ์โปรไฟล์/ทะเบียนทรัพย์สิน + เอกสารส่วนตัว = private bucket (PDPA)
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
- [ ] P3.5 (Addendum A) วันหยุดชดเชย (leave type→earning §A) + เงินชดเชยเลิกจ้าง ม.118 ใน offboarding + หักทรัพย์สินสูญหาย→deduction line + ปุ่มพิมพ์ใบเตือน
- [ ] P3 e2e ครบ + gate review

## P4 — เงิน
- [ ] P4.1 SC pool กรอกมือ + allocation แก้ได้ + หักอัตโนมัติ (ใบเตือน/ลา/สายซ้ำ) + จ่าย 15
- [ ] P4.2 payroll engine ครบสูตร §A (÷30, OT divisor ต่อคน, SSO 875, tax 3 โหมด, part-time 3 แบบ, หักลาห้าม override)
- [ ] P4.3 payrun flow + สลิปพิมพ์ 9×5.5 itemized + หัวบริษัทตามสังกัด
- [ ] P4.4 (Addendum A) commission_entries→สลิป + ไฟล์โอนธนาคาร BBL + ลดหย่อน ล.ย.01 (progressive) + PVD config + Tip pool (กลไกเดียวกับ SC) + หน้าเทียบสลิประหว่างงวด
- [ ] P4 e2e เทียบตัวเลขมือเป๊ะทุกเคส (รวม commission + ลดหย่อน) + gate review
- expected values file: (จดพาธเมื่อสร้าง)

## P5 — ประเมิน & รายงาน & แดชบอร์ด
- [ ] P5.1 เอนจินประเมินครบ + tier ติดลบเสียบ SC + คะแนนแยกไม่เปิดชื่อ
- [ ] P5.2 ภงด.1/1ก + 50ทวิ + สปส.1-10 + e-filing + หนังสือรับรอง PDF
- [ ] P5.3 แดชบอร์ด HR/ผจก.(copy ไลน์)/Staff
- [ ] P5.4 (Addendum A) ประเมินทดลองงาน (ผูก probation_end) + e-Payslip แจ้ง LINE + รายงาน %แรงงาน vs ยอดขาย (เป็นรายงาน ไม่ใช่หน้าแรก) + รายงานผู้บริหารรวม + Onboarding checklist + ปุ่มพิมพ์ผลประเมิน/ตารางกะ
- [ ] P5.5 (Addendum A — ห้ามข้าม) enforce multi-HR per-store scope จาก hr_manager_scopes จริงทุก endpoint/หน้า (เลิก global-only)
- [ ] P5 e2e ครบ + security review + build เขียว
- [ ] สรุปรายงานรวมให้เจ้าของ (รอสั่ง push)

## Open questions / assumptions ระหว่างทาง
- (ตั้งต้น) ยอดหัก SC ต่อวันลา = สัดส่วน ÷30 ของ SC เดือนนั้น — configurable
- (ตั้งต้น) part-time รายเดือน = ไม่มีใบเตือนเหมือน part-time อื่น
- (P0.2) HR gate เป็น **global** ผ่าน `can_manage_hr()` — per-store scoping ผ่าน `hr_manager_scopes` เลื่อนไปเฟสหลัง (ตารางสร้างไว้แล้ว)
- (P0.2) `hr_employees.rate_satang` ความหมายขึ้นกับ pay_type (full_monthly/pt_monthly=ราย ​เดือน, pt_daily=รายวัน, pt_hourly=รายชม.)
- (P0.2) SSO ceiling เก็บเป็น satang (1,750,000 = 17,500 บาท → SSO สูงสุด 875) · ot_multipliers jsonb {ot1:1.5,ot2:2,ot3:3}
- (รอเคาะ P1.1) รูปพนักงาน→ bucket public `deposit-photos` folder 'employees' ได้เลย · แต่ **เอกสารส่วนตัว (สำเนาบัตร/สัญญา) ยังไม่มี pattern private bucket ในโปรเจกต์** — ต้องตัดสินใจก่อน build part-time (บังคับแนบสำเนาบัตร)

## Post-loop backlog (งานเก็บหลัง loop จบ — ไม่อยู่ในขอบเขต loop)
- [ ] รอบ feedback UI จากลูกค้า/ทีมจริง ทุกโมดูล (เหมือนรอบเทส eval mockup)
- [ ] นำเข้าพนักงานจริง 73 คน (PII — ทำแยกด้วยความระวัง) + map ร้าน↔นิติบุคคล + ปักหมุด GPS จริง + ตั้ง scope HR จริง
- [ ] Field test มือถือจริงที่หน้าร้าน (กล้อง/GPS/permission บน iOS Safari + Android)
- [ ] ให้บัญชี (คุณเม) validate: ยื่น ภงด.1/สปส. จริง + เทียบสลิปพิมพ์กับกระดาษ 9×5.5 จริง
- [ ] เคาะ assumptions ทั้งหมดใน "Open questions" ข้างบนกับลูกค้า
- [ ] ไล่เช็คแจ้งเตือน LINE ครบทุก event + จูนกัน VPN หลังใช้จริง
- [ ] P6 Recruitment (ตัดออกจาก loop นี้โดยตั้งใจ)
- [ ] (จาก audit เช็คลิสต์ 70 — ติ๊กไว้แต่นอกขอบเขต loop) เครื่องสแกนนิ้ว/หน้า (ต้องมี hardware) · Google Calendar sync · แผนอบรม Training เต็มรูป · KPI/OKR เต็มรูป (พื้นฐานครอบด้วย §G แล้ว)
- [ ] push ขึ้น repo + deploy (รอเจ้าของสั่งเท่านั้น)

## Log ต่อรอบ (รอบละบรรทัด: วันที่ · ทำอะไร · commit hash)
- 2026-07-02 · Round 1: P0.1 reconcile (next=00078) + P0.2 core schema 6 ตาราง+RLS+seed16, verify SQL ผ่าน, typecheck baseline เขียว · 2b455b2
