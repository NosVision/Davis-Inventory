# P4 Payroll — Expected values (hand-computed, satang-exact)

> The payroll engine (`src/lib/hr/payroll.ts`, `computePayslip`) must reproduce EVERY line
> below exactly. Money is integer satang (฿1 = 100 satang). Company config (HR Test Co):
> `sso_rate=0.05`, `sso_wage_ceiling_satang=1,750,000` (→ SSO cap **87,500 satang = ฿875**),
> `day_divisor=30`, `ot1_multiplier=1.5`. Formula source: HR-PLAN §A/§E/§H.
>
> Rules encoded: salary ÷30; OT = (rate÷30÷ot_hour_divisor)×1.5×hours (ot_eligible only);
> SSO = min(rate×5%, 87,500); tax = progressive PND1 | 3% of base | none; leave salary
> deduction ÷30/day (classifyLeaveEffect.deductSalary); travel allowance docked ÷30/leave-day;
> late per §E tier (>15→฿50, >30→฿100, >60→฿250); warnings do NOT touch salary (SC only).

## S1 — hr-test-staff (full_monthly, rate ฿18,000 = 1,800,000, 8+1, div 8, OT-eligible, progressive, SSO)
Inputs: OT 120 min · travel allowance ฿1,500 (150,000) · SC net ฿5,000 (500,000) · leave ลากิจ 2 days (salary+travel) · late 1× 20 min · no absent.

Earnings:
- salary = 1,800,000
- ot = (1,800,000/30/8)=7,500/h ×1.5 ×2h = **22,500**
- allowance travel = 150,000
- service_charge = 500,000
- **gross = 2,472,500**

Deductions:
- leave_unpaid ลากิจ = 1,800,000/30 ×2 = **120,000**
- travel_leave = 150,000/30 ×2 = **10,000**
- late 1× (20min>15) = **5,000**
- sso = min(90,000, 87,500) = **87,500**
- tax progressive: annual ฿216,000 − exp 100,000 − personal 60,000 − sso 9,000 = ฿47,000 < 150k → **0**
- **total_deduction = 222,500**

**net = 2,472,500 − 222,500 = 2,250,000** (฿22,500.00)

## S2 — hr-test-staff9 (full_monthly, rate ฿21,000 = 2,100,000, 9+1, div 9, OT-eligible, progressive, SSO)
Inputs: OT 180 min · no allowance · SC net 0 (200% warning wiped it) · no leave · no absent · no late.

Earnings:
- salary = 2,100,000
- ot = (2,100,000/30/9)=7,777.7778/h ×1.5 ×3h = round(35,000.0) = **35,000**
- **gross = 2,135,000**

Deductions:
- sso = min(105,000, 87,500) = **87,500**
- tax progressive: annual ฿252,000 − 100,000 − 60,000 − 9,000 = ฿83,000 < 150k → **0**
- **total_deduction = 87,500**

**net = 2,135,000 − 87,500 = 2,047,500** (฿20,475.00) — warning does NOT reduce salary (SC only).

## S3 — hr-test-parttime (pt_hourly, rate ฿60/h = 6,000, withholding_3pct, no SSO/OT/SC)
Inputs: 80 hours worked.

Earnings:
- salary = 6,000 ×80 = **480,000**
- **gross = 480,000** (no OT, no SC — part-time)

Deductions:
- sso = **0** (part-time, not enrolled)
- tax withholding_3pct = 480,000 ×0.03 = **14,400**
- **total_deduction = 14,400**

**net = 480,000 − 14,400 = 465,600** (฿4,656.00)

## S4 — synthetic (full_monthly, rate ฿9,000 = 900,000, NOT OT-eligible, SSO, tax none)
Inputs: unauthorized absent 1 day · late tiers [16, 31, 61] min · no OT/leave/allowance/SC.

Earnings:
- salary = **900,000** · **gross = 900,000**

Deductions:
- absent = 900,000/30 ×1 = **30,000**
- late = (16>15→5,000)+(31>30→10,000)+(61>60→25,000) = **40,000** (3×)
- sso = min(45,000, 87,500) = **45,000** (below cap — uncapped path)
- tax none = **0**
- **total_deduction = 115,000**

**net = 900,000 − 115,000 = 785,000** (฿7,850.00)

---

# P4.4 additions (ล.ย.01 allowance · PVD · Tip) — hand-computed, satang-exact

> These extend the engine (same `computePayslip`). All use a ฿50,000/mo (5,000,000 satang)
> full_monthly employee, 30 worked days, SSO ฿875, no OT/leave/late for isolation.
> PND1 ladder: 0–150k @0, 150k–300k @5%, 300k–500k @10%, … Standard deductions: expense
> 50% cap ฿100k, personal ฿60k, SSO = actual annual contribution (฿875×12 = **฿10,500**, the 2026
> ฿17,500 ceiling; the old ฿9,000 cap dated to the ฿750/mo era and over-taxed high earners).

## S5 — ล.ย.01 tax allowance (progressive) — matches `progressiveMonthlyTaxSatang` assert 5/5
Base ฿50,000/mo → annual ฿600,000. expense=100k, personal=60k, sso=**10,500** (actual, ตรงไฟล์จริง June 2026).
- **No allowance:** taxable = 600k−100k−60k−10.5k = **429,500** → tax/yr = 7,500 + (129.5k@10%=12,950) = **20,450** → /12 → **170,417 satang/mo** (฿1,704.17 — ตรงกับสลิปจริง)
- **+฿120,000 allowance** (spouse 60k + child 30k + insurance 30k): taxable = 429.5k−120k = **309,500** → tax/yr = 7,500 + (9.5k@10%=950) = **8,450** → /12 → **70,417 satang/mo** (฿704.17)
- **+฿281,000 allowance** (taxable → 150,000, bottom of ladder): tax/yr = **0** → **0/mo**

## S6 — PVD (กองทุนสำรองเลี้ยงชีพ) — matches PVD assert 10/10
Base ฿50,000/mo, **3% employee PVD**, progressive tax, SSO ฿875.
- PVD deduction = round(5,000,000 × 0.03) = **150,000 satang** (฿1,500), line `provident_fund` ref `3.00%`
- PVD annual = 1,500 × 12 = ฿18,000 → added to tax-allowance base
- taxable = 431,000 − 18,000 = **413,000** → tax/yr = 7,500 + (113k@10%=11,300) = **18,800** → /12 → **156,667 satang/mo** (฿1,566.67)
- tax saving vs no-PVD = 171,667 − 156,667 = **15,000**; net drop vs no-PVD = pvd − saving = 150,000 − 15,000 = **135,000**
- Part-time / zero-rate / not-enrolled → **no PVD line** (gated)

## S7 — Tip pool — matches Tip assert 9/9
Tip net (allocated − deductions) fed as a `tip` earning.
- Alloc ฿30,000 (3,000,000) − manual deduction ฿5,000 (500,000) = **net 2,500,000** → earning line `tip` = 2,500,000, added to gross AND net
- **Unlike SC, tips are NOT gated on pay type** — a pt_daily employee still gets the tip line (but no service_charge line)
- undefined / 0 tip → no line
