# HR / Payroll Module — Delivery Summary (for the owner)

> Davis-Inventory HR build. Status as of 2026-07-04 (Round 96). **All commits are local — nothing has been pushed.**

## What was delivered

A full multi-tenant HR + payroll module on the existing Next.js + Supabase stack, money as integer satang throughout.

| Phase | Scope | Status |
|-------|-------|--------|
| **P0** | HR permission (`can_manage_hr`), module registration, `/hr` dashboard, audit log | ✅ |
| **P1** | Employees (§A/§I fields, part-time UX, private docs), org, positions, assets, policies, announcements, audit | ✅ |
| **P2** | Attendance (§F geofenced check-in), schedule, timesheet, overrides, warnings | ✅ |
| **P3** | Leave engine (§E: policy/quota/§H interaction), requests, swaps, claims, offboarding, profile-change | ✅ |
| **P4.1–4.4** | Payroll engine (÷30, SSO cap 875, dual tax), Service Charge, payruns + printable slips, commission/bank-file/ล.ย.01/PVD/tip pool, **payslip-compare** | ✅ (commission→slip pending owner) |
| **P5.1** | §G monthly evaluation — periods→criteria→assignments→scoring→results→payout (linear/tiered), **negative payout → SC deduction**, anonymized per-evaluator breakdown | ✅ end-to-end (HR + evaluator + employee UIs) |
| **P5.2** | Statutory reports (ภ.ง.ด.1/1ก, สปส.1-10, register), e-filing CSV, **50-ทวิ PDF**, **work/salary certificate PDF** | ✅ |
| **P5.3** | Dashboards — Staff ESS home `/me`, manager/HR daily "who's in today" + copy-to-LINE | ✅ |
| **P5.5** | Per-store scope enforcement across all store-partitioned operational routes | ✅ |

## Verification evidence (ground truth)

- **Offline engine regression** — `node scripts/hr-assert-all.cjs` = **5 suites / 206 checks** (payroll 36 · eval 34 · tax-reports 41 · SC 14 · misc 81 covering all 10 pure libs). Satang-exact vs hand-computed expectations.
- **Live-auth e2e** — `node scripts/hr-e2e/run-all.cjs` = **17 suites / 285 checks**, all through real Supabase auth + 2-layer RLS (payroll lifecycle, tax-allowance, bank-file, PVD, tip, evaluation + money bridges, statutory reports, per-store scope T1–T4, daily dashboard).
- **Production build** — `next build` **GREEN** (✓ compiled 20.6s, 237/237 static pages).
- **UI** — key surfaces chrome-verified against the live app (payroll, evaluation all 3 roles, ESS home, daily dashboard, payslip-compare, certificate + 50-ทวิ PDF).

## Blocked / needs owner or authenticated access

1. **commission → payslip** — the engine already accepts `commission` earnings, but a separate `commission_payment` channel already pays AEs. Wiring commissions into the payslip risks **double payment**. Needs an owner decision (exclude-already-paid vs close the old channel) before it's turned on.
2. **Security advisor sweep** — `get_advisors` on the live Supabase project (DAVIS) requires interactive MCP auth, which isn't available in this headless session. Last run (Round 46) was **0 ERROR** on all `hr_*` tables/functions; a fresh run should be done from an authenticated session before production.
3. **Push** — all work is committed locally only. Awaiting owner go-ahead to push.

## Known follow-ups (P1.5 / P5.4 backlog, non-blocking)

Org chart view, salary/position-history view (data already in `hr_audit_log`), probation-end (119-day) reminders, LINE e-payslip delivery, management roll-up report, onboarding checklist, print buttons. These need external integrations or are polish; core payroll/HR is complete without them.

## Migrations

Schema is file-tracked through `00111`. Migration `00111` (line-type CHECK reconcile for `provident_fund`/`tip`) is authored and matches the live DB (verified by constraint probe); apply via an authenticated MCP/CLI session when convenient — it is a history reconcile, not an active bug.
