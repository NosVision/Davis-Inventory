# รายงานสรุปการออกแบบ UI — ระบบ HR/Payroll (44 หน้า, 3 บทบาท: HR / Store-Manager / Employee-ESS)
*เอกสารตัดสินใจสำหรับเจ้าของผลิตภัณฑ์ — จาก UI audit 12 agents / 44 หน้า (2026-07-05)*

---

## 1. บทสรุป (Executive Summary)

ตอนนี้ UI ของระบบ HR **ทำงานได้ครบ แต่ "อ่านไม่ออกด้วยตา"** — เกือบทุกหน้าเป็น *เทมเพลตเดียวกันซ้ำ ๆ*: หัวข้อ `text-xl` หนึ่งบรรทัด ตามด้วยกำแพงการ์ด/แถวสีเทา `divide-y` ที่ทุกฟิลด์เป็น `text-sm/text-xs` น้ำหนักเท่ากันหมด ตัวเลขที่สำคัญที่สุดของแต่ละหน้า (เงินเดือนสุทธิ, ยอดหักค่าจ้าง, จำนวนวันลา, จำนวนรออนุมัติ, มูลค่าทรัพย์สินรวม) ถูก "ฝัง" เป็นข้อความสีเทากลางประโยค แทนที่จะเป็น **ตัวเลขพระเอก (hero figure)** จุดอ่อนเชิงระบบที่ใหญ่ที่สุดคือ **ไม่มี design tokens และไม่มี shared primitives** — แม้แต่หน้าที่ดีที่สุด (`hr/dashboard`) ก็ยัง copy-paste `inputCls` และประดิษฐ์ `Card / StatTile / SectionHeading` ของตัวเองภายในไฟล์ ทำให้ภาษาการออกแบบดี ๆ ที่มีอยู่แล้วไม่ถูกนำกลับมาใช้ที่อื่นเลย

**โอกาส:** เรามีต้นแบบคุณภาพระดับที่ต้องการอยู่แล้วหนึ่งหน้า (`hr/dashboard` + `overview-charts.tsx` — KPI stat tiles, ตัวเลข `text-2xl/3xl` tabular, สีตามสถานะที่จับคู่กับ label เสมอ, recharts, layout แบ่ง Today/This-month) การ **"สกัดต้นแบบนี้ออกมาเป็น design-system layer แล้วลากอีก 43 หน้าเข้าหามัน"** คือ ROI สูงสุด เพราะงานหนักด้านภาษาภาพทำเสร็จไปแล้ว เหลือแค่ทำให้ reusable

**ภาพคะแนนรวม (เฉลี่ย 44 หน้า, เต็ม 5):**

| แกน | คะแนนเฉลี่ย | อ่านว่า |
|---|---|---|
| **Hierarchy (ลำดับชั้น)** | **2.36** | 🔴 อ่อนสุด — ทั้งแอปแบน ไม่มีจุดให้สายตาเกาะ |
| **Emphasis (เน้นข้อมูลสำคัญ)** | **2.52** | 🔴 อ่อนรองลงมา — ตัวเลขสำคัญถูกฝัง |
| **Design Quality (anti-template)** | **2.59** | 🟠 เทมเพลตการ์ดเทาซ้ำ ๆ |
| **A11y** | 3.27 | 🟡 พอใช้ แต่มี input ไม่มี label + `window.confirm` |
| **Responsive** | 3.32 | 🟡 ดีสุด แต่ `max-w-3xl` บีบหน้าข้อมูลหนาแน่น |

- **หน้าที่แย่สุด (ต้องยกเครื่อง):** `me/swaps` (11/25), `hr/claims` (11/25), `me/leaves` / `me/ot-requests` / `me/claims` / `hr/requests` / `hr/swaps` / `hr/reports` / `me/announcements` (12/25) — ทั้งหมดคือกลุ่ม list/queue ที่แบนที่สุด
- **หน้าที่ดีสุด (ใช้เป็นเกณฑ์):** `me/checkin` (20/25) และ `me/evaluation-results` (19/25 — มี ScoreRing เป็น hero) รองมาคือ `hr/dashboard` และ `hr/payroll/compare` (มี DeltaCell/สี semantic)

**สรุปหนึ่งประโยค:** ปัญหาไม่ใช่ราย ๆ หน้า แต่คือ *"ไม่มีชั้นกลาง (design system)"* — แก้ที่ชั้นกลางครั้งเดียว ยกคุณภาพได้ทั้ง 44 หน้า

---

## 2. ปัญหาเชิงระบบ (Systemic Issues)

ปัญหาเหล่านี้ **ข้ามหน้า** — ไม่ควรแก้ทีละหน้า แต่ต้องแก้ที่รากเดียว

### 2.1 ไม่มี Design Tokens — สีฮาร์ดโค้ด + `inputCls` copy-paste
`globals.css` แทบไม่มี custom property เลย (มีแค่ font + scrollbar + print) ทุกหน้าเลยฮาร์ดโค้ด `indigo-600 / gray-300 / text-gray-500` ตรง ๆ และ **คัดลอก `inputCls` เดิม ๆ** ไปทุกไฟล์ (เห็นชัดใน `hr/dashboard/page.tsx:63`) → เปลี่ยน accent สีเดียวต้อง grep ทั้ง repo, dark-mode ต้องเขียนซ้ำทุกจุด
**ทำไมสำคัญ:** ทำให้ทุกการปรับแก้แพงและไม่สม่ำเสมอ / **แพร่หลายแค่ไหน:** ทุกหน้า 44 หน้า

### 2.2 ไม่มี Shared Page Primitives — แต่ละหน้าประดิษฐ์เอง
ไม่มี `PageHeader`, `StatTile`, `DataList`, `FilterBar`, `MoneyValue` ที่ใช้ร่วมกัน แม้แต่หน้า dashboard ก็ประกาศ `Card / SectionHeading / PersonList / stats[]` ภายในไฟล์ตัวเอง → หน้าอื่นเข้าไม่ถึง
**ทำไมสำคัญ:** ทุกหน้าเลย reinvent ทำให้เกิด drift / **แพร่หลาย:** ทุกหน้า

### 2.3 Uniform flat card/list ไม่มีลำดับชั้น (ตรงกับข้อห้าม anti-template)
รูปแบบเดียวกันเป๊ะ: `divide-y` list, ชื่อ `text-sm font-medium`, meta `text-xs` สีเทา, hover เป็น indigo จุดเดียว
**พบใน:** `hr/policies`, `hr/announcements`, `hr/leaves`, `hr/requests`, `hr/swaps`, `hr/warnings`, `hr/claims`, `hr/evaluation`, `me/leaves`, `me/ot-requests`, `me/claims`, `me/announcements`, `me/policies`, `hr/org`, `hr/locations` (15+ หน้า)

### 2.4 ตัวเลขสำคัญเรนเดอร์เป็น "ข้อความธรรมดา" (Emphasis 2.52)
ตัวเลขที่หน้านั้น *มีไว้เพื่อสิ่งนี้* กลับถูกฝังกลางประโยค:
- เงินเดือนสุทธิ payrun อยู่ใน `tfoot` เป็น `text-sm` (`hr/payroll:345-354`)
- ยอดหักค่าจ้างจากใบเตือน `scEffect` เป็น `text-xs` เทา (`hr/warnings`, `me/warnings:196`)
- จำนวนวันลาเป็น `text-xs` เทาข้าง ๆ วันที่ (`me/leaves:295`, `hr/leaves:244`)
- มูลค่าทรัพย์สินรวม `totalSatang` ถูกคำนวณ **เพื่อ PDF เท่านั้น ไม่โชว์บนจอ** (`hr/assets:259`)
- จำนวนคน acknowledge policy ต้องเปิด modal ถึงจะเห็น (`hr/policies`)

### 2.5 `max-w-3xl` บีบหน้าที่ข้อมูลหนาแน่นบน desktop
หน้าที่ HR ใช้บนจอ 1440 กลับถูกล็อกที่ ~768px เหลือ gutter ว่างมหาศาล
**พบใน:** `hr/policies`, `hr/announcements`, `hr/leave-types`, `hr/leaves`, `hr/requests`, `hr/swaps`, `hr/warnings`, `hr/claims`, `hr/offboarding`, `hr/locations`, `hr/payroll/compare` (queue/config ที่ควรกว้าง)

### 2.6 Filter/Action bar พังบนมือถือ
แถบ reject-note (raw input + 2 ปุ่ม) `flex-wrap` เบียดกันที่ 320–375px; filter grid เหลือครึ่งคอลัมน์ว่าง
**พบใน:** `hr/swaps`, `hr/requests`, `hr/leaves`, `hr/claims`, `hr/offboarding`, `me/attendance-requests`, `me/swaps`

### 2.7 Empty/Loading state อ่อน
Loading เป็น `…` ellipsis เปล่า ๆ (`hr/org:201`) แทน skeleton; หลายหน้าไม่มี EmptyState

### 2.8 สถานะสื่อด้วย "สีอย่างเดียว" + A11y ช่องโหว่ซ้ำ ๆ
- `Badge size="sm"` = `text-[10px]` amber-on-amber → contrast ก้ำกึ่ง (หลายหน้า)
- input มีแต่ `placeholder` ไม่มี `<label>/aria-label` (`hr/employees:344`, reject-note ทุกหน้า queue, `me/schedule` month input, `me/evaluations` scoring inputs)
- ใช้ `window.confirm / window.prompt` แทน Modal ที่ accessible (`hr/payroll:152,170`, `hr/service-charge:273`, `me/claims:134`, `me/profile:223`, `me/evaluations:132` ฯลฯ)
- `hr/offboarding:487` แถวเป็น `<li onClick>` ไม่มี role/tabIndex → **คีย์บอร์ดเข้าไม่ถึง** (severity สูง)
- report-type pills ไม่มี `role=tab`/`aria-selected` (`hr/reports`)

---

## 3. แนวทางที่เสนอ — Design System (ข้อเสนอหลัก)

สร้าง **"ชั้นกลาง" ครั้งเดียว** แล้วใช้ซ้ำทั้งแอป ทุกอย่างสกัดจากภาษาที่ `hr/dashboard` พิสูจน์แล้วว่าได้ผล

### (a) Design Tokens — เพิ่มใน `globals.css` (`@theme` + `:root`)

ยกชุด `--viz-*` ที่ตอนนี้ฝังเป็น string ใน `dashboard/page.tsx:68-70` ขึ้นมาเป็น token ระดับแอป และเพิ่ม role tokens:

```css
:root {
  /* surface / ink */
  --surface: #ffffff;    --surface-2: #f9fafb;
  --ink: #111827;        --ink-muted: #6b7280;   --border: #e5e7eb;
  /* accent */
  --accent: #4f46e5;     /* indigo-600 ที่ใช้ทั่วแอป */
  /* semantic status (จับคู่ label เสมอ ไม่ใช่สีเดี่ยว) */
  --good:#0ca30c; --warn:#fab219; --serious:#ec835a; --critical:#d03b3b;
  /* radius / space scale */
  --r-card:0.75rem; --r-pill:9999px;
  /* form control token — ฆ่า inline inputCls */
  --control: 1px solid var(--border);
}
.dark { --surface:#1f2937; --surface-2:#111827; --ink:#f9fafb; --ink-muted:#9ca3af; --border:#374151; }
```

- **`--control`** + คลาส utility `.control` แทน `inputCls` ที่ copy-paste อยู่ทุกไฟล์
- Status token ทำให้ badge/แถบ/ตัวเลขทั้งแอปพูดภาษาสีเดียวกัน (good/warn/serious/critical) และ **map ตรงกับ recharts** ที่มีอยู่แล้ว

### (b) Reusable Page Primitives (สร้างใน `src/components/ui/`)

| Primitive | สเปคหนึ่งบรรทัด | เก็บกวาดหน้าไหนทันที |
|---|---|---|
| **`PageHeader`** | title + subtitle + `actions` slot, responsive (`flex-wrap`, action ไม่ตกบรรทัดมั่ว) | ทั้ง 44 หน้า (แทน h1+div ที่เขียนเอง) |
| **`StatTile` / `KpiRow`** | label + hero value (`text-2xl/3xl tabular-nums`) + icon chip + สี tone; grid `2→3→6 cols` | payroll, service-charge, tip-pool, assets, claims, attendance, timesheet, reports, employees |
| **`DataCard` / `DataList`** | แถวที่มี **primary field เด่น + key value เน้น (ขวา) + meta รอง + actions ชิดขวา**; hover/focus state จริง; left status-rail | ทุกหน้า queue/list (policies, leaves, requests, swaps, warnings, claims, ทั้ง HR และ ESS) |
| **`FilterBar`** | ห่อ filter+search, `flex-wrap` คุมได้, ยุบเป็นแถวเดียว/ปุ่ม "ตัวกรอง" บนมือถือ, `min-h-40px` | queue ทุกหน้า, attendance, timesheet, reports |
| **`StatusBadge`** | รับ `status` → คืน **สี + label + icon** (ไม่ใช่สีเดี่ยว), ขนาดขั้นต่ำอ่านออก (เลิก `text-[10px]`) | ทุกหน้าที่มีสถานะ (~35 หน้า) |
| **`MoneyValue`** | รับ satang → `฿x,xxx.xx` tabular, prop `emphasis` (hero/inline), สี semantic เมื่อเป็นยอดหัก/ลบ | payroll, compare, service-charge, tip-pool, claims, warnings, payslips, assets |
| **`SectionHeading`** | หัวข้อกลุ่ม `text-base font-bold` + extra slot (ยกจาก dashboard:246) | หน้าที่มีหลาย section (payroll, evaluation/[id], profile, dashboard) |
| **`StatusRail` / `ProgressPill`** | แถบสีซ้ายการ์ด + pill "2/3 คืนแล้ว" | offboarding, evaluation, policies, schedule |
| **`EmptyState` (อัปเกรด)** | + variant `loading` (skeleton แทน `…`) | ทุกหน้า list |

### (c) Emphasis Patterns — กฎ "เน้นส่วนสำคัญ"

**กฎเหล็ก:** ทุกหน้าต้องนำด้วย *key data* ของตัวเองในรูป **stat tile / hero figure / colored total** — ห้ามฝังเป็นข้อความ ตัวอย่าง before→after จากหน้าจริง:

1. **Payroll net** — *ก่อน:* net เป็น `tfoot` `text-sm` หนึ่งใน 5 คอลัมน์ → *หลัง:* `KpiRow` เหนือตาราง (Employees / Gross / SSO+Tax / **NET เป็น `text-3xl` พระเอก**) + `MoneyValue emphasis="hero"`
2. **Warning severity + amount** — *ก่อน:* `scEffect` `text-xs` เทากลางการ์ด → *หลัง:* pill สีแดง `−50% ค่าจ้าง` ขนาด `text-base font-semibold` ข้าง level badge + KPI แถบบน (Active / รอเซ็น / Void)
3. **Leave status + days** — *ก่อน:* "3 วัน" เทาข้างวันที่, status badge `text-[10px]` → *หลัง:* การ์ดมี **status-rail สีซ้าย** + ตัวเลข **`3 วัน` เป็น `text-2xl`** เป็น anchor + `StatusBadge` มี icon
4. **Pending counts (hub/queue)** — *ก่อน:* `hr/page` 24 tile ไม่มี badge, `me/page` 15 tile ไม่มี count → *หลัง:* tile ที่ actionable ได้ **count badge สด** (แบบ pendingRows ใน dashboard:414) + จัดกลุ่ม tile เป็น section (People/Time/Pay/Ops)

### (d) Responsive Rules

- **ความกว้างตามชนิดหน้า:**
  - *ข้อมูลหนาแน่น* (queue, table, payroll, report, config) → **`max-w-6xl` ขึ้นไป** (เลิก `max-w-3xl`)
  - *ฟอร์ม/capture* (certificates, checkin, ฟอร์มยื่นคำขอ ESS) → คงแคบ `max-w-lg/2xl`
- **ตาราง:** ทุกตารางห่อ `overflow-x-auto` + คอลัมน์ entity แรก `sticky left-0` (attendance, timesheet, schedule)
- **Filter bar:** ยุบเป็นปุ่มตัวกรอง/accordion บนมือถือ ผ่าน `FilterBar`
- **Touch targets:** ปุ่ม icon แถว action **≥ 40px** (ตอนนี้ `p-1/p-1.5` ≈ 28px ใน employees, payroll)
- **Modal:** `size` สัมพันธ์เนื้อหา; ฟอร์มยาวใช้ body scroll (มีแล้วใน `modal.tsx:106`) — บังคับใช้แทน `window.confirm/prompt`

---

## 4. โรดแมปจัดลำดับความสำคัญ (Prioritized Roadmap)

### 🏗️ Tier 0 — สร้างฐาน Design System *(ปลดล็อกทุกอย่าง — ทำก่อนเสมอ)*
- **งาน:** tokens ใน `globals.css` + primitives ข้อ (b) ทั้งหมด + `.control` แทน `inputCls`
- **Effort:** ~2–3 วัน (ภาษาภาพยกจาก dashboard ได้เลย)
- **Payoff:** ทุก tier ถัดไปกลายเป็น "เสียบ primitive" ไม่ใช่เขียนใหม่

### 💰 Tier 1 — หน้ามูลค่าสูง/ทราฟฟิกสูง *(impact สูง)*
- **หน้า:** `hr/payroll`, `hr/payroll/compare`, `me/payslips`, `hr/warnings` + `me/warnings`, `hr/service-charge`, `hr/tip-pool`, `hr/claims` + `me/claims`
- **งาน:** ใส่ `KpiRow` + `MoneyValue` (net/ยอดหักเป็น hero), colored total, delta banner (compare)
- **Effort:** ~0.5 วัน/หน้า **Payoff:** ตัวเลขเงินที่คนตัดสินใจจริงเด่นทันที — เปลี่ยนความรู้สึกทั้งโมดูลเงิน

### 🧭 Tier 2 — Hub + รายการงานประจำวัน *(ทราฟฟิกสูงสุด)*
- **หน้า:** `hr/page` (24 tile), `me/page` (15 tile), `hr/employees`, `hr/schedule` (manager daily), queue อนุมัติ (`hr/leaves/requests/swaps/profile-requests`)
- **งาน:** count badge สดบน tile + จัดกลุ่ม section; `DataList` + status-rail + pending KPI strip; employees ใส่ KPI headcount
- **Effort:** ~0.5–1 วัน/หน้า **Payoff:** ผู้ใช้เห็น "งานค้าง" ก่อนคลิก — hub กลายเป็นหน้าสถานะ

### ⚡ Tier 3 — Quick wins สลับ primitive *(effort ต่ำ)*
- **หน้า:** `hr/assets`, `hr/attendance` (risk KPI + tint แถว suspect), `hr/timesheet` + `me/timesheet` (SummaryChips→KpiRow), `hr/reports` (grand total KPI), `me/leaves/ot-requests/attendance-requests/swaps`, `me/schedule`, `me/offboarding`
- **Effort:** ~2–4 ชม./หน้า **Payoff:** ยกทั้งกลุ่ม list ให้พ้นเทมเพลตแบน

### 🧹 Tier 4 — Polish + A11y *(ลำดับท้าย)*
- **หน้า:** `hr/org` (skeleton, muted inactive row), `hr/locations` (2-col + map/radius chip), `hr/certificates` (two-pane live preview), `hr/evaluation` + `[id]`, `me/profile` (identity header), `me/announcements`/`me/policies` (priority/pending group), `hr/offboarding` (แถวเป็น `<button>` — แก้ keyboard), `me/evaluations` (label scoring inputs)
- **Payoff:** ปิดช่องโหว่ a11y + ยกหน้าที่เหลือให้ครบระบบ

---

## 5. Quick Wins (ทำได้เลย — ถูกแต่เห็นผลกว้าง)

1. **สร้าง `StatTile` + `KpiRow` แล้วเสียบ 6 หน้าเงิน/สรุปทันที** (payroll, service-charge, tip-pool, claims, assets, reports) — net/total กลายเป็นพระเอกทั่วโมดูลในครั้งเดียว
2. **Tokenize `inputCls` → `.control` + token** ใน `globals.css` แล้ว find-replace ทั้ง repo — ลบหนี้ copy-paste ทันที
3. **ขยายหน้าข้อมูลหนาแน่นจาก `max-w-3xl` → `max-w-6xl`** (queue + config ~11 หน้า) — คืนพื้นที่ desktop โดยแทบไม่แตะ layout อื่น
4. **`MoneyValue` component** ใส่ payroll/payslip/warnings — ยอดเงินสี semantic + tabular ทันที
5. **`StatusBadge` (สี+label+icon, เลิก `text-[10px]`)** สลับแทน `Badge size="sm"` ทุกจุด — แก้ contrast + สื่อสถานะไม่ใช่สีเดี่ยว พร้อมกันทั้งแอป
6. **แทน `window.confirm/prompt` ด้วย `Modal` ที่มีอยู่แล้ว** (`modal.tsx`) — ปิดช่อง a11y ~7 หน้าเงิน/lifecycle
7. **`FilterBar` wrapper** ห่อแถบ filter/reject-note — แก้ปัญหา `flex-wrap` เบียดบนมือถือทุกหน้า queue พร้อมกัน
8. **`hr/assets`: โชว์ `totalSatang` บนจอ** (ตอนนี้คำนวณเพื่อ PDF อย่างเดียว) — เพิ่ม KPI แถวเดียว ได้ตัวเลข roll-up ที่หายไปกลับมาฟรี

---

**อ้างอิงไฟล์จริง:** ต้นแบบคุณภาพ = `src/app/(dashboard)/hr/dashboard/page.tsx` + `_components/overview-charts.tsx`; primitives ปัจจุบัน = `src/components/ui/` (button, badge, card, input, select, modal, empty-state); tokens ต้องเพิ่มที่ `src/app/globals.css` (ตอนนี้มีแค่ font/scrollbar/print)
