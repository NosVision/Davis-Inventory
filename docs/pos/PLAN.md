# แผนพัฒนา POS — Davis-Inventory

> เอกสารแผน (source of truth) สำหรับการต่อยอดระบบ POS / PR-PO / BOM / Waste / รับออเดอร์
> เข้าโซนโค้ด POS เมื่อไหร่ ให้อ่าน `src/app/(pos)/CLAUDE.md` คู่กับไฟล์นี้
> อัปเดตล่าสุด: 2026-06-30

---

## 1. บริบท & เป้าหมาย

ลูกค้าเปิด **บาร์ + ร้านอาหาร** หลายสาขา ปัจจุบันใช้ **Easy Restaurant** (เคยใช้ FoodStory แต่ไม่ตอบโจทย์)
ต้องการย้ายมาระบบเดียวที่คุม **สต๊อก + ขายหน้าร้าน + สูตร (BOM) + ของเสีย (waste) + รับออเดอร์** ครบในที่เดียว
และต่อยอดบน Davis-Inventory ที่มีอยู่ (สต๊อก/โอน/แจ้งซ่อม/พิมพ์ผ่าน local agent)

**เป้าหมาย v1:** ระบบ POS ที่ขายได้แม้เน็ตหลุด, ตัดสต๊อกตาม BOM อัตโนมัติ, เห็นยอดทุกสาขาแบบเรียลไทม์ (ไม่ต้องกด sync HQ), นำร่อง **1 สาขา**

---

## 2. ปัญหาเดิม (Easy Restaurant) — วิเคราะห์

| อาการที่ลูกค้าเจอ | สาเหตุเชิงสถาปัตยกรรม |
|---|---|
| เรียกดูข้อมูลย้อนหลังเยอะ ๆ แล้วค้าง | MySQL on-premise ต่อสาขา, query หนักบนเครื่องร้าน |
| รายการขายชอบค้าง | เก็บ/อ่านบนเครื่อง local เดียวกับที่ขาย |
| ต้องกด "อัปเดต HQ" ถึงเห็นข้อมูลทุกสาขา | รวมข้อมูลแบบ batch merge เข้า HQ ด้วยมือ |
| ต้องอัปโหลดไฟล์ POS เพื่อเช็กสต๊อก | ไม่มี data pipeline เชื่อมสต๊อกอัตโนมัติ |

**ข้อสรุป:** ปัญหาอยู่ที่ **topology** (หลาย MySQL silo + รวมมือ) ไม่ใช่ยี่ห้อ DB
**ทางแก้:** single cloud Postgres (Supabase) + realtime push + local cache ที่ตัวเครื่อง → ยอดทุกสาขาเห็นทันที, สต๊อกอัปเดตในตัว

---

## 3. หลักการออกแบบ (Design Principles)

1. **DB เดียวบนคลาวด์** — POS ใช้ Supabase Postgres ก้อนเดียวกับ Davis-Inventory (ref `oogyjqywuqmutkjnnsik`) ไม่แยก DB
2. **Offline-first** — เครื่องขายต้องขายต่อได้ตอนเน็ตหลุด แล้วค่อย sync (เงินสดออฟไลน์ได้, บัตร/QR ต้องมีเน็ต)
3. **Local-first + outbox/event-log** *(แนวทางที่เอนเอียง — ยังไม่ล็อก)* — งานขายเขียนเป็น event immutable (append-only) มี client-generated ULID, คิวใน IndexedDB, flush ขึ้น server แล้ว apply แบบ idempotent
4. **เงิน = integer (สตางค์)** ไม่ใช้ float; บิลที่ปิดแล้วไม่แก้ ให้ต่อด้วย event ใหม่
5. **Reuse ของเดิม** — print agent, ตาราง `stores`, roles, auth, UI kit ใช้ซ้ำ ไม่สร้างใหม่

---

## 4. ขอบเขต v1 (In / Out)

**In scope**
- POS core: เปิดบิล/โต๊ะ, เพิ่มรายการ, คิดเงิน, พิมพ์ใบเสร็จ, เปิดลิ้นชัก
- รับออเดอร์ (order-taking) + ย้ายโต๊ะ
- BOM/สูตร → ตัดวัตถุดิบอัตโนมัติเมื่อขาย
- Waste log (ของเสีย) ตัดสต๊อก
- ชำระเงิน Beam (เงินสด/PromptPay/บัตร)
- เห็นยอดทุกสาขาเรียลไทม์

**Out (เฟสถัดไป)**
- PR/PO เต็มรูป (มี pattern header+items+approval+print เดิมรองรับ — ความเสี่ยงต่ำ ทำทีหลัง)
- รายงาน/วิเคราะห์ขั้นสูง, โปรโมชัน/สมาชิก, มัลติเทอร์มินอลต่อโต๊ะแบบซับซ้อน

---

## 5. สถาปัตยกรรม

### 5.1 โครงตาราง (ร่าง — ปรับได้)
- `pos_tables`, `pos_zones` — โต๊ะ/โซน ผูก `store_id`
- `pos_orders` — บิล (มี `table_id` เป็น pointer, `status`, `store_id`, ยอดเป็นสตางค์)
- `pos_order_items` — รายการในบิล (ผูกเมนู, qty, ราคา ณ ขณะขาย)
- `menu_items` / `menu_categories` — เมนูขาย
- `recipes` (BOM) — เมนู → วัตถุดิบ (qty ต่อหน่วยขาย) เชื่อมสต๊อกเดิม
- `waste_logs` — ของเสีย ตัดสต๊อก
- `payments` — การชำระ (cash/promptpay/card, ref Beam, สถานะ)
- `pos_events` — **outbox/event-log** (append-only; client ULID; idempotency key)

### 5.2 Offline outbox/event-log *(ตัดสินใจร่วมกันก่อนเริ่มเขียน)*
```
ขาย → สร้าง event (ULID + idempotency key) → เขียน IndexedDB ทันที (UI ตอบเร็ว)
     → flush ขึ้น Supabase เมื่อมีเน็ต → server apply idempotent → realtime push ไปสาขาอื่น/HQ
```
สิ่งที่ต้องเคลียร์ก่อนเลือก outbox vs SQLite replication → ดูข้อ 8

### 5.3 ฮาร์ดแวร์ (reuse local print agent เดิม)
- **ลิ้นชักเก็บเงิน**: drawer-kick `1B 70 00 19 FA` ผ่าน **`RawPrint.ps1` (raw ESC/POS)** — ไม่ใช่ path HTML→PDF (มันตัด ESC/POS ทิ้ง)
- **ใบเสร็จ**: ต่อยอดจาก `print_queue` + agent ที่ดาวน์โหลดไปรันที่ร้าน

### 5.4 ชำระเงิน — Beam
- อุปกรณ์: Bolt+ smart terminal (บัตร/ผ่อน/Alipay/WeChat/QR PromptPay), PromptPay ฟรี
- เชื่อม: REST API + Bolt Intent API (Paired / Deep-link) + Webhooks; PCI DSS L1
- เลี่ยงความเจ็บปวดของ bank-EDC SDK certification
- **ยังไม่ล็อก**: โหมดเชื่อม Paired vs Deep-link

---

## 6. โมเดลโต๊ะ (สำคัญ)
- **โต๊ะ = pointer ไม่ใช่บิล** — ย้ายโต๊ะ = เปลี่ยน `pos_orders.table_id` (บันทึกเป็น event `table_moved`)
- **Table ownership** — ให้ 1 เทอร์มินอล "เป็นเจ้าของ" โต๊ะที่เปิดอยู่ ณ เวลาหนึ่ง เพื่อกัน conflict ตอนเขียนออฟไลน์พร้อมกัน

---

## 7. เฟสการทำงาน (นำร่อง 1 สาขา)

| เฟส | ชื่อ | ผลลัพธ์ |
|---|---|---|
| 0 | เคลียร์โจทย์ + ตัดสินใจ offline | ปิดคำถามข้อ 8, ล็อก outbox vs SQLite, schema ร่าง |
| 1 | POS core (ออนไลน์ก่อน) | เปิดบิล/โต๊ะ, ขาย, พิมพ์ใบเสร็จ + เปิดลิ้นชัก |
| 2 | BOM + Waste | ขายแล้วตัดวัตถุดิบอัตโนมัติ, log ของเสีย |
| 3 | Offline + sync | outbox/event-log, ขายต่อตอนเน็ตหลุด, realtime ทุกสาขา |
| 4 | ชำระเงิน Beam | เชื่อมเครื่อง + webhook, ปิดบิลด้วยบัตร/QR |
| 5+ | ขยาย | PR/PO เต็ม, รายงาน, โรลเอาต์สาขาอื่น |

---

## 8. คำถามที่ต้องเคลียร์กับลูกค้า (ก่อนเฟส 1)
1. เน็ตหลุดจริงนานแค่ไหน (วินาที/นาที/ชั่วโมง)?
2. กี่เครื่อง POS ต่อสาขา?
3. พนักงานหลายคนแก้โต๊ะเดียวกันพร้อมกันไหม?
4. MySQL ของ Easy Restaurant เป็นแบบ store-only หรือมี HQ คลาวด์? schema เดิมแชร์ได้ไหม (ช่วยตอนย้ายข้อมูล)?
5. โหมดเชื่อม Beam: Paired หรือ Deep-link?

---

## 9. Decisions log (ล็อกแล้ว ณ 2026-06-30)
- นำร่อง 1 สาขาก่อน
- รองรับทั้งบาร์และร้านอาหาร
- จ่ายเงิน v1 = Beam (Bolt+ + PromptPay ฟรี)
- ลิ้นชักผ่าน RawPrint raw ESC/POS (พิสูจน์แล้วว่าทำได้ ~90% มีของเดิมอยู่)
- DB เดียวกับ Davis-Inventory
- โต๊ะ = pointer + table ownership

**ยังไม่ล็อก:** กลยุทธ์ออฟไลน์ (outbox/event-log vs SQLite replication) · โหมดเชื่อม Beam

---

## 10. ความสัมพันธ์กับระบบเดิม (reuse)
- Supabase project เดียว (`oogyjqywuqmutkjnnsik`), RLS, auth, roles เดิม (owner/manager/accountant/bar/technician/staff)
- ตาราง `stores` (store_name, active) ใช้เป็นสาขา POS
- Local print agent (`print_queue` + `RawPrint.ps1`) ใช้พิมพ์ใบเสร็จ + เปิดลิ้นชัก
- UI kit `@/components/ui`, auth `@/stores/auth-store`, supabase clients `@/lib/supabase/{client,server}`

---

## ความเสี่ยง
- **Offline correctness** คือความเสี่ยงสูงสุด — ต้อง idempotent + กัน conflict (table ownership) ตั้งแต่ออกแบบ
- **เงิน** — ใช้ integer สตางค์, บิลปิดแล้ว immutable, reconcile กับ Beam webhook
- **Hardware ที่ร้าน** — ต้องเทสต์ลิ้นชัก/ปรินเตอร์จริงต่อรุ่น
