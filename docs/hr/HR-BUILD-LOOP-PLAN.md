# HR Build — Loop Execution Plan (P0–P5)

> แผนสั่งงานผ่าน `/loop` แบบไม่หยุดถาม · สเปกอ้างอิง = `docs/hr/HR-PLAN.md` (§A–J เป็น source of truth เสมอ ห้ามเดาขัดกับมัน)
> สถานะงานอยู่ที่ `docs/hr/HR-BUILD-STATE.md` — **ทุกรอบ loop ต้องอ่าน STATE ก่อน แล้วอัปเดตเมื่อจบรอบ**

---

## กฎเหล็ก (ทุกรอบ ทุก agent)

1. **ห้าม `git push` เด็ดขาด** — commit local ได้ (conventional commits, ทีละ work unit) เพื่อเป็น checkpoint แต่ไม่ push จนกว่าเจ้าของสั่ง
2. **typecheck ต้องเขียวก่อน commit ทุกครั้ง**: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit --pretty false | grep "error TS"` ต้องว่าง
3. **Migration = เขียนไฟล์ + apply ทันที**: สร้าง `supabase/migrations/000XX_*.sql` (เช็คเลขถัดไปจากไฟล์ที่มี + `mcp__supabase__list_migrations` กันชนกับที่ apply ไว้แล้ว) → apply ด้วย `mcp__supabase__apply_migration` ลงโปรเจกต์ `oogyjqywuqmutkjnnsik` → verify ด้วย `execute_sql` · **ห้าม ALTER/DROP ตารางเดิมของระบบสต๊อก** (แตะได้เฉพาะ `hr_*` + FK อ่าน profiles/stores) · ทุกตาราง hr_* ต้องมี **RLS** + เขียน **hr_audit_log** ทุก mutation (§B)
4. **e2e ด้วย chrome-devtools MCP กับ `http://localhost:3000`** (dev server รันอยู่; ถ้าดับให้ `npm run dev` แบบ background) — ทุก work unit ต้องมี e2e ผ่านจริงก่อนติ๊ก STATE: navigate → snapshot → click/fill → verify ผลบนจอ + ยิง SQL เช็คข้อมูลลง DB จริง · จอที่ต้องเทส: desktop 1440 + mobile 390
5. **Sub-agents แบ่งงาน** (Agent tool, รันขนานเมื่อไม่พึ่งกัน):
   - `db-agent` — migration + RLS + seed + verify SQL
   - `api-agent` — API routes + lib (ตาม pattern `src/app/api/**` เดิม)
   - `ui-agent` — pages/components + i18n keys (th/en parity เช็คด้วย node script ทุกครั้ง)
   - `e2e-agent` — เดิน flow ผ่าน chrome MCP + รายงานผล (ใช้ ToolSearch โหลด mcp__chrome-devtools__*)
   - `review-agent` (code-reviewer) — จบทุกเฟสต้องรีวิว แก้ CRITICAL/HIGH ให้หมดก่อนปิดเฟส
6. **จบแต่ละรอบ loop**: อัปเดต `HR-BUILD-STATE.md` (ติ๊ก + จด open questions/assumptions) → commit local → เรียก skill **`handoff`** สรุปบริบทเป็นไฟล์ไว้ที่ temp dir → รอบถัดไปอ่าน handoff + STATE ต่อได้ทันที
7. **เจอความกำกวม**: ใช้ default ใน HR-PLAN → จดลง STATE หัวข้อ "open questions" → **ทำต่อ ห้ามหยุดรอ**
8. **Test users** (สร้างครั้งเดียวใน P0 ผ่าน service role): `hr-test-owner`(role owner) / `hr-test-hr`(staff + can_manage_hr) / `hr-test-manager`(manager, ผูก venue เดียว) / `hr-test-staff`(staff, ot_eligible, 8+1) / `hr-test-staff9`(staff, 9+1, divisor 9) / `hr-test-parttime`(part-time รายชั่วโมง) — รหัสสุ่มเก็บที่ scratchpad `hr-test-creds.json` **ห้าม commit** · ตั้ง `active=true` + ผูก user_stores กับ venue ทดสอบ
9. **ห้าม commit ความลับ**: `.mcp.json`, creds, service keys — เช็ค `git status` ก่อน commit ทุกครั้ง
10. UI ทั้งหมด = next-intl namespace `hr` (th+en ครบคู่), เงินเก็บสตางค์ (int), เวลา Asia/Bangkok ตัดรอบตี 6, ตามกติกา CLAUDE.md เดิมทุกข้อ

---

## Work units ต่อเฟส (ทำตามลำดับ · 1 รอบ loop ≈ 1–2 units)

### P0 — ฐานราก
- **P0.1 Reconcile migrations**: เทียบ `supabase/migrations/*.sql` กับ `list_migrations` จริง — backfill ไฟล์ที่ apply ไปแล้วแต่ไม่มีไฟล์ (เช่น 00075/00076 hr_checklist) แล้ว lock เลขถัดไป
- **P0.2 Core tables** (migration เดียวหรือแยกชุด): `hr_companies` (+ CRUD, ย้ายพนักงานข้ามบริษัท effective_date+reason+audit) · `hr_positions` (seed 16: Manager, Assistant Manager, Captain, Head Bar, Bartender, Bar Back, Cashier, Service, Runner, Head Hostess, Housekeeping, Security, Admin, Sound Engineer, Graphic, Assistant) · `hr_departments` · `hr_employees` (ทุกฟิลด์ §A/§I: rate_satang, pay_type full_monthly|pt_hourly|pt_daily|pt_monthly, work_hours_per_day 8|9, break_hours, ot_eligible, ot_hour_divisor, standard_days_off 6|8, tax_mode, sso_enrolled, company_id, position_id, department_id, supervisor_id, bank, sso_no, tax_id, emergency_contact, documents jsonb, start_date, probation_end) · `hr_audit_log` · `hr_manager_scopes` (scope ของ can_manage_hr ต่อ user×store)
- **P0.3 สิทธิ์ + โมดูล**: เพิ่ม permission `can_manage_hr` เข้า type + หน้าให้สิทธิ์รายคนเดิม · เพิ่มโมดูล `hr` ใน registry (เห็นเฉพาะ owner + ผู้มี can_manage_hr; ซ่อนจาก role อื่น) · โครง route `/hr` + แดชบอร์ดว่าง + i18n namespace `hr` เริ่มต้น · helper `src/lib/hr/audit.ts`
- **P0.4 Test users + e2e ฐาน**: สร้าง users ตามกฎข้อ 8 → e2e: login owner เห็นเมนู HR เข้าได้ / login staff ไม่เห็นเมนู / typecheck+commit
- **Gate ปิดเฟส**: ตาราง P0 ทั้งหมดอยู่ใน DB จริง (verify SQL) · RLS เปิดครบ · review-agent ผ่าน

### P1 — คน & นโยบาย
- **P1.1 ทะเบียนพนักงาน**: หน้า list (ค้นหา + กรอง venue/position/department/pay_type) + สร้าง/แก้โปรไฟล์เต็ม + อัปโหลดรูป/เอกสาร (reuse photo-upload) · **เลือก part-time แล้วบังคับโปรไฟล์อัตโนมัติ: tax 3%, ปิด SSO/OT/SC/ใบเตือน, บังคับแนบสำเนาบัตร+ลายเซ็น** · ปุ่มย้ายบริษัท (audit+reason)
- **P1.2 Positions/Departments CRUD** + หน้า audit log รวม (§B) + ประวัติแก้ไขต่อระเบียน
- **P1.3 นโยบาย + ประกาศ**: `hr_policies` (คู่มือ 18 หมวด, HR แก้ได้, พนักงานอ่าน+เซ็นรับทราบ+timestamp) · `hr_announcements` (scope สาขา, รับทราบ/ไม่รับทราบ, **ไม่รับทราบ→เด้งซ้ำวันถัดไป**)
- **P1.4 ทะเบียนทรัพย์สิน**: `hr_assets` CRUD + ผูกผู้ถือ + มูลค่า + สถานะคืน
- **e2e เฟส**: สร้างพนักงาน full-time + part-time (เช็ค auto-profile) · ย้ายบริษัท · CRUD ตำแหน่ง · ประกาศ→staff กดไม่รับทราบ→เช็คว่าเด้งซ้ำ · audit log มีรายการครบ

### P2 — เวลา (เช็คอิน/ตาราง/timesheet)
- **P2.1 Locations + เช็คอิน**: `hr_locations` (store_id, lat, lng, radius_m — HR ตั้งได้) · `hr_attendance` (type in|out|break_start|break_end, gps, distance_m, in_geofence, photo_url, ip, ip_country, is_vpn_suspect, device) · หน้าเช็คอิน PWA: GPS→geofence→**selfie กล้องหน้า→canvas ฝังลายน้ำ (เวลาไทยจริง+พิกัด+สาขา) ก่อนอัปโหลด**→บันทึก · **พัก = flow เดียวกันเป๊ะ (GPS+selfie)** · **กัน VPN/GPS ปลอม**: เก็บ IP ฝั่ง server → เทียบ IP-geo กับ GPS (ห่างผิดปกติ) + เช็ค datacenter/VPN range → set is_vpn_suspect + หน้ารายงานให้ HR (flag ไม่บล็อก) · **dev-only bypass ปุ่มอัปโหลดรูปแทนกล้อง** (NODE_ENV=development) เพื่อให้ e2e เดินได้; geolocation ใน e2e ใช้ CDP override/evaluate_script
- **P2.2 ตารางงาน**: `hr_shift_templates` + `hr_schedule` (draft→submitted→acknowledged) · UI ผู้จัดการจัดรายเดือนต่อ venue (grid วัน×คน, copy สัปดาห์, อ้างชั่วโมงหลัก 8+1/9+1) + **แผงตัวช่วย: คนต่อวัน/กะ, วันหยุดต่อคนเทียบเกณฑ์ 6|8, ไฮไลต์วันขาด/ล้น** · ส่งให้ HR รับทราบ · ESS "ตารางของฉัน"
- **P2.3 สลับวันหยุด + เอนจินเวลา**: `hr_dayoff_swaps` (คู่สลับ+วัน → ผู้อนุมัติ **ตั้งได้ต่อร้าน (ผจก./กัปตัน)** → อนุมัติ → HR รับทราบเฉย ๆ → ตารางอัปเดต) · เอนจินคิด สาย/ขาด/ชม.OT เทียบกะ+ตัดตี 6 · **OT เฉพาะ ot_eligible เกินชั่วโมงตัวเอง** · ชม.พักจริงเทียบ break_hours → รายงาน
- **P2.4 คำขอเวลา (J4/J5/J8)**: `hr_ot_requests` (ขอล่วงหน้า→อนุมัติ→**OT จ่ายได้ = อนุมัติ ∩ ทำจริง**) · `hr_attendance_requests` (ลืมกด→ขอแก้→อนุมัติ→แก้พร้อม flag+audit) · หน้า **Timesheet ต่อคน/งวด** (HR แก้ได้+เหตุผล+audit)
- **e2e เฟส**: ตั้งพิกัด→เช็คอิน (mock GPS ใน+นอกรัศมี, เช็ค watermark ขึ้นรูป, เช็คแถว DB) · พัก/เลิกพัก · จัดตาราง+ส่ง+รับทราบ · สลับวันหยุดเต็ม flow · ขอ OT + ขอแก้เวลา · timesheet แก้แล้ว audit ขึ้น

### P3 — คำขอ & วินัย
- **P3.1 เอนจินลา**: `hr_leave_types` (config §D) + `hr_holidays` (**PH 13 วัน default, HR แก้ได้**) + `hr_leaves` (validate ล่วงหน้า/โควตา/เอกสาร; ลาป่วย>3วันบังคับใบรับรอง; แนบรูป; สายอนุมัติ) · ผูกผลการลาตามตาราง §H: ขาดงาน(ลากิจ/ป่วยไม่มีใบ)→หักเงินเดือน÷30+SC+ค่าเดินทาง · ป่วยมีใบ→ไม่หักเงินเดือน แต่หัก SC+เดินทาง · พักร้อน/PH→ไม่หัก
- **P3.2 ใบเตือนเต็มระบบ**: `hr_warnings` — ระดับ **วาจา/25%/50%/100%/200% (หัก SC 2 งวด carry-forward)/ระบุบาท** · แนบรูปหลักฐาน · ออกโดย HR หรือ ผจก. · เซ็น 3 ฝ่าย (พนักงาน+ผจก.+HR, signature pad) · **หักทันทีงวด SC ถัดไป** · อายุ 12 เดือน · audit
- **P3.3 eClaims (J2)**: `hr_claims` ยื่น+รูปบิล→อนุมัติตามสาย→รอจ่าย (ผูก payslip earning P4)
- **P3.4 ESS แก้ข้อมูล (J6) + Offboarding**: `hr_profile_change_requests` (บัญชีธนาคารบังคับอนุมัติเสมอ) · ลาออก/เลิกจ้าง: ใบ+เซ็น+เช็คคืนทรัพย์สิน (โยง hr_assets)+สรุปเงินถึงวันที่+ปิด active
- **e2e เฟส**: ลาป่วย 4 วันไม่แนบใบ→ถูกบล็อก→แนบแล้วผ่าน→อนุมัติ→flag หักครบ 3 ช่อง · ออกใบเตือน 50% เซ็นครบ · ใบเตือน 200% เห็น carry 2 งวด · claim→อนุมัติ · แก้บัญชีธนาคาร→รอ HR

### P4 — เงิน (SC + payroll)
- **P4.1 Service Charge (§H)**: `hr_service_charge_pools` (ยอดกอง**กรอกมือ**/เดือน) + `hr_sc_allocations` (**ตารางหยอดต่อคน แก้ได้** — ไม่มีสูตร) + บรรทัดหักอัตโนมัติ: ใบเตือน (รวม 200% carry) / ผลประเมิน (P5 มาเสียบ) / มาสายซ้ำ 5·6·7→25/50/100% / วันลา (สัดส่วน ÷30 configurable) → ยอดสุทธิต่อคน · จ่ายรอบวันที่ 15 · lock/finalize+audit
- **P4.2 Payroll engine (§A)**: `hr_payruns`+`hr_payslips`+`hr_payslip_earnings`+`hr_payslip_deductions`+`hr_recurring_deductions` (จอดรถ 1400/จยย.300/canteen−50) · งวด 26–25 → generate สลิปทุกคน: ÷30×วันทำงาน · **OT = rate÷30÷ot_hour_divisor(ต่อคน)×มัลติ×ชม.(จาก approved∩actual)** · SSO min(5%,875) เฉพาะ enrolled · tax progressive/3%/none · part-time 3 แบบ · **หักลาอัตโนมัติแบบบรรทัดแยก ห้าม override มือ** · ค่าเดินทางตามกฎวันลา · SC line จาก P4.1 · ใบเตือน/บทลงโทษไม่แตะเงินเดือน (SC เท่านั้น)
- **P4.3 สลิป + flow**: หน้า payrun review→finalize (ล็อก, reopen ต้องเหตุผล+audit)→**พิมพ์ 9×5.5" itemized ทุกบรรทัด + หัวบริษัทตามสังกัดพนักงาน**
- **e2e เฟส (สำคัญสุด — ต้อง assert ตัวเลขเป๊ะ)**: เตรียมข้อมูลเดือนทดสอบให้พนักงานเทสครบเคส (คน 8+1 มี OT, คน 9+1 divisor 9, part-time รายชั่วโมง, ลากิจ 2 วัน, ป่วยมีใบ 1 วัน, ใบเตือน 50%+200%, มาสายครั้งที่ 5) → รัน payrun → **เทียบตัวเลขกับที่คำนวณมือไว้ในไฟล์ expected ทุกบรรทัด** → print preview ถูก
- **Gate**: review-agent + เช็คตรงสูตร §A ทุกข้อ

### P5 — ประเมิน & รายงาน & แดชบอร์ด
- **P5.1 เอนจินประเมิน (§G)**: ตาราง hr_eval_* ครบชุด · timeline default เปิด~30/ตัด 10/เห็นก่อน 15 · UI 3 ฝั่งตาม mockup (`public/hr-eval-mockup.html` เป็นแบบ): HR ตั้งงวด+เกณฑ์ (default 15 หัวข้อ)+มอบหมาย (รองรับต่อแผนก) · ผู้ประเมิน = คิวทีละคน+auto-advance+clamp · พนักงาน = วงแหวน+breakdown+**คะแนนแยกผู้ประเมินไม่เปิดชื่อ**+เทรนด์ (เห็นหลังปิดงวดเท่านั้น) · **tier ติดลบ = ยอดหัก SC** เสียบเข้า P4.1 อัตโนมัติ
- **P5.2 รายงาน + เอกสาร (J3/J9)**: ภ.ง.ด.1/1ก · 50 ทวิ · สปส.1-10 + ไฟล์ e-filing · ทะเบียนเงินเดือน · หนังสือรับรองการทำงาน/เงินเดือน (ขอ→ออก PDF)
- **P5.3 แดชบอร์ด 3 ระดับ**: HR (รวม/แยก venue) · ผจก.ต่อ venue (เข้างานวันนี้/ลา/ป่วย + **ปุ่ม copy ข้อความสรุปไปวางไลน์**) · Staff ESS home (เช็คอิน/ตาราง/ขอลา/สลับวันหยุด/ใบเตือน/สลิป/คะแนน)
- **e2e เฟส**: ครบวงจรประเมิน→ปิดงวด→ยอดหักโผล่ใน SC→staff เห็นคะแนนแบบไม่เปิดชื่อ · ออก 50 ทวิ/หนังสือรับรอง PDF · แดชบอร์ดทุก role
- **Gate ปิดโปรเจกต์**: review-agent + security-review (RLS ทุกตาราง, ไม่มี endpoint หลุด) · typecheck+build เขียว · สรุปรายงานรวม + รายการ open questions ทั้งหมดให้เจ้าของ · **หยุดรอเจ้าของสั่ง push เอง**

---

## Addendum A — audit กับเช็คลิสต์ 70 ข้อที่เจ้าของติ๊ก (2026-07-02: ติ๊กครบทั้ง 70)

> เทียบรายข้อแล้ว รายการต่อไปนี้**เพิ่มเข้า work units** (loop ต้องทำด้วย):

**เพิ่มใน P1:** โครงสร้างองค์กร Org chart อย่างง่าย (จาก supervisor_id) · ประวัติปรับเงินเดือน/เลื่อนตำแหน่ง (view จาก hr_audit_log ของ rate/position) · **แจ้งเตือนครบกำหนดทดลองงาน 119 วัน** · แจ้งเตือนวันเกิด/ครบรอบงาน (แดชบอร์ด)
**เพิ่มใน P3:** วันหยุดชดเชย (leave type + ผูก earning "ชดเชยวันหยุด" ที่มีใน §A แล้ว) · **เงินชดเชยเลิกจ้าง/ค่าบอกกล่าว (ม.118)** ใน offboarding · หักทรัพย์สินสูญหาย → เข้าสลิปเป็น deduction line
**เพิ่มใน P4:** **ดึงค่าคอมจาก `commission_entries` เข้าสลิป** (สัญญาไว้ตั้งแต่ integration แรก!) · **ไฟล์โอนเงินเข้าธนาคาร (BBL format)** · **ลดหย่อนภาษี ล.ย.01 ต่อคน** สำหรับโหมด progressive · PVD (เป็น config deduction type เปิด/ปิดได้) · Tip pool (ใช้กลไกเดียวกับ SC allocation — ตารางกรอกมือ) · หน้าเทียบสลิประหว่างงวด
**เพิ่มใน P5:** ประเมินทดลองงาน (งวดพิเศษผูก probation_end) · e-Payslip แจ้งผ่าน LINE (ใช้ infra LINE เดิม) · รายงาน %ต้นทุนแรงงาน vs ยอดขาย (เป็น "รายงาน" ไม่ใช่หน้าแรก — ตามที่ลูกค้าเคยสั่งเอาออกจากแดชบอร์ด) · รายงานผู้บริหารสรุปรวม · Onboarding checklist อย่างง่าย (template รายการ + ติ๊กต่อพนักงานใหม่)
**Cross-cutting (ทุกเฟส):** **"ทุกเอกสารพิมพ์ได้"** — ใบเตือน/ผลประเมิน/โปรไฟล์/ทะเบียนทรัพย์สิน/ตารางกะ ต้องมีปุ่มพิมพ์+print CSS เหมือนสลิป · **multi-HR per-store scope ต้อง enforce จริงก่อนปิด P5 gate** (schema `hr_manager_scopes` มีแล้ว — ห้ามจบ loop แบบ global-only) · PDPA: เอกสารส่วนตัว (สำเนาบัตร/สัญญา) เก็บ **private bucket + signed URL** เท่านั้น

**ย้ายเข้า post-loop backlog อย่างเป็นทางการ (ติ๊กไว้แต่นอกขอบเขต loop นี้ — แจ้งเจ้าของแล้ว):** เครื่องสแกนนิ้ว/หน้า (ต้องมี hardware จริง) · Google Calendar sync · แผนอบรม Training เต็มรูป · KPI/OKR ต่อเนื่องเต็มรูป (ระดับพื้นฐานถูกครอบด้วยเอนจินประเมิน §G แล้ว) · Recruitment (P6 ตามแผนเดิม)
**Superseded โดยคำตอบลูกค้า (ไม่ทำตามเช็คลิสต์เดิม):** เช็คอิน QR → ใช้ GPS geofence+selfie (§F) · SC pool จากยอด POS → กรอกมือ (§H) · เบี้ยขยัน → ไม่มีในระบบเงินจริง (ทำเป็น allowance config เปิดได้ถ้าอยากใช้)

---

## คำสั่งเริ่ม loop (ให้เจ้าของใช้)

```
/loop ทำงานตาม docs/hr/HR-BUILD-LOOP-PLAN.md ต่อจากสถานะใน docs/hr/HR-BUILD-STATE.md — อ่าน STATE + handoff ล่าสุดก่อน, ทำ 1-2 work unit ต่อรอบด้วย sub-agents, e2e ผ่าน chrome mcp ทุก unit, typecheck เขียวแล้ว commit local (ห้าม push), จบรอบอัปเดต STATE + เรียก skill handoff แล้วไปรอบถัดไป จนจบ P5
```
