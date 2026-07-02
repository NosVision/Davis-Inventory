# HR Build — State Tracker

> loop อ่านไฟล์นี้ก่อนเริ่มทุกครั้ง · ติ๊ก [x] เมื่อ e2e ผ่าน + typecheck เขียว + commit local แล้วเท่านั้น
> อัปเดตล่าสุด: 2026-07-02 (จบ Round 6 — **P1.2 เสร็จ** (positions/departments CRUD + audit-log page) → ถัดไป P1.3)

## สถานะรวม
- เฟสปัจจุบัน: **P1.1 + P1.2 ✅ เสร็จ → ถัดไป P1.3 policies + announcements (ไม่รับทราบ→เด้งซ้ำ)**
- dev server: localhost:3000 (UP) · Supabase: oogyjqywuqmutkjnnsik (live)
- **เลขไมเกรชันถัดไป = 00081** (ถึง 00080_hr_docs_bucket_hardening applied+verified)
- test creds: `f:\tmp\hr-test-creds.json` (6 บัญชี hr-test-* + test venue store_code=HRTEST · re-seed ได้ด้วย `node scripts/seed-hr-test-users.mjs`) — ห้าม commit
- handoff ล่าสุด: `f:\tmp\hr-handoff-latest.md`

## P0 — ฐานราก
- [x] P0.1 reconcile migrations — next=00078, ไม่มี hr_* system tables เดิม, drift เก่าไม่บล็อก (2b455b2)
- [x] P0.2 core tables: hr_companies / hr_positions(seed16 ✓) / hr_departments / hr_employees / hr_audit_log / hr_manager_scopes — RLS 12 policies, verify SQL ✓, advisor clean สำหรับ hr_* (2b455b2)
- [x] P0.3 can_manage_hr (4 sync points: type union + permissions route + i18n + registry) + โมดูล hr (กลุ่ม moduleGroups.hr) + /hr dashboard skeleton (12 tiles) + i18n `hr` namespace th/en + lib/hr/audit.ts (logHrAudit → hr_audit_log) — typecheck เขียว
- [x] P0.4 test users 6 บัญชี (owner/hr+can_manage_hr/manager/staff8+1/staff9+1/parttime) + hr_employees time profiles + e2e chrome MCP: owner เห็น HR+เปิด /hr / staff ไม่เห็น / hr(perm) เห็น — ผ่านทั้ง desktop 1440 + mobile 390
- [x] P0 gate: code-reviewer ผ่าน (0 CRITICAL) · แก้ 1 HIGH + 4 MED แล้วใน 00078 + guard: (1) canManageHr() helper + /hr server guard (กัน accountant wildcard split-brain — verify staff โดน redirect, owner/HR เข้าได้) (2) ลบ hr_audit_log INSERT policy ที่ปลอมได้ (3) hr_employees/hr_companies read = HR-only (4) profile_id FK cascade→restrict (5) seed ไม่ echo password · commits c6c6d55/5ffbda8/eddf957

## P1 — คน & นโยบาย
- [x] P1.1 ทะเบียนพนักงาน — **เสร็จครบ** (backend 54e4089 + UI 7ad4350 + fixes 89fd2a3 + transfer bc0eb9c)
  - backend: private bucket + API (list/onboard/get/update/transfer) + `/api/hr/documents` + lib · adversarial 5-lens review แก้ CRIT+8HIGH+12MED+LOW · API e2e ครบ
  - UI: employees list (DataTable + search + 5 filters + rate/badges) + create/edit form modal (ทุกฟิลด์ §A/§I, part-time UX forcing + require id_card/signature, doc upload private, temp password) + dashboard tile link + i18n th/en (96/96)
  - **e2e ผ่าน 1440+390**: list render (8 คน) + server search (hooyh→2) + create full-time ผ่านฟอร์ม → temp password → list refresh ✓ · edit-mode prefill ✓ (rate 30000, company disabled, terminal→end_date fields โผล่)
  - **code-review UI แก้ครบ** (89fd2a3): stale-fetch race guard, offboarding end_date/end_reason fields, PT→FT tax/sso reset, save-during-upload guard, create-success refresh, rate>0, aria-labels
  - **Round 5 (bc0eb9c)**: TransferModal + list row-action → POST /transfer · i18n transfer (th/en 112/112) · e2e: transfer ผ่าน UI → DB company + audit reason ✓ · doc upload→sign (download disposition) ✓ · edit-save PUT ✓
  - หมายเหตุ tech-debt: form modal 871 บรรทัด (เกิน 800 — แตก sub-components ทีหลัง) · profile avatar_url ยังไม่รองรับใน create/edit (เลื่อน P1.5)
- [x] P1.2 positions/departments CRUD + audit-log page (435cb92) — API (list/create/update/delete, 409 dup + 409 FK-in-use, logHrAudit ทุก mutation) + `/hr/org` (tabs + add/rename/reorder/toggle active) + audit API (filter table/action/record_id, paginated) + `/hr/audit` page · i18n th/en (org 21/21, audit 17/17) · e2e ผ่าน API+UI (create/dup-409/rename/toggle + org+audit render สะท้อนข้อมูลจริง incl transfer reasons) · (review agent กำลังรัน)
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
- (P0.2) HR gate เป็น **global** ผ่าน `can_manage_hr()` — per-store scoping ผ่าน `hr_manager_scopes` เลื่อนไปเฟสหลัง (ตารางสร้างไว้แล้ว) · **⚠️ P5.5 บังคับ enforce จริงทุก endpoint ก่อนปิดโปรเจกต์ (ห้ามข้าม)**
- (P0 gate) app-layer HR authz ใช้ `canManageHr()` (src/lib/hr/access.ts) เท่านั้น — **ห้ามใช้ `hasPermission(user,'can_manage_hr')`** เพราะ wildcard role (accountant) จะผ่าน app แต่ RLS บล็อก = split-brain
- (P0.2) `hr_employees.rate_satang` ความหมายขึ้นกับ pay_type (full_monthly/pt_monthly=ราย ​เดือน, pt_daily=รายวัน, pt_hourly=รายชม.)
- (P0.2) SSO ceiling เก็บเป็น satang (1,750,000 = 17,500 บาท → SSO สูงสุด 875) · ot_multipliers jsonb {ot1:1.5,ot2:2,ot3:3}
- (P0 gate) hr_employees ตอนนี้ HR-only read (ถอด self-view ออก) — **ESS "โปรไฟล์ฉัน" ต้องอ่านผ่าน view/API จำกัดคอลัมน์** (ไม่ให้เห็น notes/bank/tax/end_reason) เมื่อ build ESS (P2/P3)
- (✅ ทำแล้ว P1.1) เอกสารส่วนตัว = **private bucket `hr-documents`** (public=false, size 10MB, mime allow-list) + signed URL (download disposition) ผ่าน `/api/hr/documents` · รูปโปรไฟล์ทั่วไปยังใช้ public `deposit-photos` folder 'employees' ได้
- (P1.1) **onboarding role gate**: elevated roles (accountant/manager/hq) สร้างได้เฉพาะ caller ที่เป็น owner · non-owner HR สร้างได้แค่ staff/bar/technician · ห้าม owner/customer — กัน privilege escalation
- (P1.1) เปลี่ยนบริษัท = **ต้องผ่าน `/api/hr/employees/[id]/transfer`** เท่านั้น (reason บังคับ) — PUT ปกติ reject company_id · transfer เป็น immediate, effective_date เก็บใน audit (ประวัติจริงเป็น table แยกใน P1.5)
- (P1.1) PUT `documents` = **full-array replace** (UI ต้องส่ง array เต็มทุกครั้ง กันลบเอกสารโดยไม่ตั้งใจ) · part-time ที่ลบ id_card/signature จะโดน 400
- (P1.1) แก้ค่าอ่อนไหว (rate/bank/sso_no/tax_id) ต้องมี `reason` (§B) · terminal status (resigned/terminated) ต้องมี end_date

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
- 2026-07-02 · Round 2: P0.3 app wiring (can_manage_hr + module + /hr + i18n + audit) + P0.4 seed 6 test users + e2e (owner/staff/hr-perm × 1440+390 ผ่าน) + P0 gate review + fixes (00078 RLS/FK + canManageHr guard, verify staff redirect) → **P0 ปิดครบ** · c6c6d55 / 5ffbda8 / eddf957
- 2026-07-02 · Round 3: P1.1 **backend** — 00079 private bucket + 00080 hardening + API (employees CRUD/transfer/documents) + lib (part-time auto-profile) · Workflow adversarial review 5-lens → แก้ CRIT role-escalation + 8 HIGH + 12 MED + LOW ครบ · API e2e ผ่านทุกเคส (create/PT-forcing/probation/sensitive-reason/transfer/escalation-403/validation) · typecheck เขียว · 54e4089 · (UI + full chrome e2e → Round 4)
- 2026-07-02 · Round 4: P1.1 **UI** — employees list (DataTable+search+filters) + create/edit form modal (part-time UX + doc upload, agent-built) + i18n th/en (100/100) + tile link · e2e 1440+390 (list 8 + search + create full-time→temp pw→refresh + edit prefill) · code-review 2HIGH+4MED+LOW แก้ครบ (stale-fetch guard, offboarding end_date, PT→FT reset) · 7ad4350 + 89fd2a3 · (transfer-UI + edit-save/doc e2e → Round 5)
- 2026-07-02 · Round 5: P1.1 **transfer UI** (TransferModal + list row-action → /transfer) + i18n (112/112) · e2e ผ่าน UI: transfer→DB company+audit reason ✓, doc upload→sign (download disposition) ✓, edit-save PUT ✓ · typecheck เขียว · **P1.1 ปิดครบ** · bc0eb9c · (→ P1.2)
- 2026-07-02 · Round 6: P1.2 **positions/departments CRUD + audit-log** (2 parallel agents) — 5 API routes + org page + audit page + i18n · e2e: pos create/dup-409/rename/toggle + dept create + org/audit render สะท้อนข้อมูลจริง · typecheck เขียว · 435cb92 · (code-review กำลังรัน → P1.3)
