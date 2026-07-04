# HR / Payroll Module — Delivery Summary (for the owner)

> Davis-Inventory HR build. Status as of 2026-07-05 (Round 104 — full gate re-verified: code + live DB). **All commits are local — nothing has been pushed.**

## What was delivered

A full multi-tenant HR + payroll module on the existing Next.js + Supabase stack, money as integer satang throughout.

| Phase | Scope | Status |
|-------|-------|--------|
| **P0** | HR permission (`can_manage_hr`), module registration, `/hr` dashboard, audit log | ✅ |
| **P1** | Employees (§A/§I fields, part-time UX, private docs), org, positions, assets, policies, announcements, audit | ✅ |
| **P2** | Attendance (§F geofenced check-in), schedule, timesheet, overrides, warnings | ✅ |
| **P3** | Leave engine (§E: policy/quota/§H interaction), requests, swaps, claims, offboarding, profile-change | ✅ |
| **P4.1–4.4** | Payroll engine (÷30, SSO cap 875, dual tax), Service Charge, payruns + printable slips, bank-file/ล.ย.01/PVD/tip pool, **payslip-compare** | ✅ (commission: owner decided 2026-07-05 — stays in the separate `/commission` channel) |
| **P5.1** | §G monthly evaluation — periods→criteria→assignments→scoring→results→payout (linear/tiered), **negative payout → SC deduction**, anonymized per-evaluator breakdown | ✅ end-to-end (HR + evaluator + employee UIs) |
| **P5.2** | Statutory reports (ภ.ง.ด.1/1ก, สปส.1-10, register), e-filing CSV, **50-ทวิ PDF**, **work/salary certificate PDF** | ✅ |
| **P5.3** | Dashboards — Staff ESS home `/me`, manager/HR daily "who's in today" + copy-to-LINE | ✅ |
| **P5.5** | Per-store scope enforcement across all store-partitioned operational routes | ✅ |

## Verification evidence (ground truth)

- **Offline engine regression** — `node scripts/hr-assert-all.cjs` = **5 suites / 206 checks** (payroll 36 · eval 34 · tax-reports 41 · SC 14 · misc 81 covering all 10 pure libs). Satang-exact vs hand-computed expectations.
- **Live-auth e2e** — `node scripts/hr-e2e/run-all.cjs` = **19 suites / 308 checks** (re-run 2026-07-05), all through real Supabase auth + 2-layer RLS (payroll lifecycle, tax-allowance, bank-file, PVD, tip, evaluation + money bridges, statutory reports, per-store scope T1–T4, daily dashboard, employee history, dashboard alerts).
- **Production build** — `next build` **GREEN** (✓ compiled 30.2s, 238/238 static pages, exit 0; re-run 2026-07-05).
- **Live DB confirm (2026-07-05)** — RLS enabled on all 52 `hr_*` tables with policies; payslip line-type CHECK constraints match migration 00111 (`provident_fund`/`tip` present); security advisors = **0 ERROR / 69 WARN / 2 INFO** (no ERROR on any `hr_*` object).
- **UI** — key surfaces chrome-verified against the live app (payroll, evaluation all 3 roles, ESS home, daily dashboard, payslip-compare, certificate + 50-ทวิ PDF).

## Blocked / needs owner or authenticated access

1. ~~**commission → payslip**~~ — **✅ RESOLVED by owner (2026-07-05)**: commissions stay in the existing separate `/commission` channel ("different logic for now; revisit in the future"). Live data supports this: 99.6% of entries belong to external AEs (`ae_profiles` — never on a payslip anyway); staff entries = 2 ever, both cancelled → zero double-pay exposure today. No code change; the engine keeps accepting a manual `commission` line via recurring if ever needed. A ready-to-build spec for the future (pull staff entries `payment_id IS NULL`, stamp on finalize) is recorded in HR-BUILD-STATE §P4.4.
2. ~~**Security advisor sweep**~~ — **✅ DONE 2026-07-05 (Round 104)**: fresh `get_advisors('security')` run against the live project (oogyjqywuqmutkjnnsik, target verified) = **0 ERROR / 69 WARN / 2 INFO**. No ERROR-level lint on any `hr_*` object; all WARNs are pre-existing codebase-wide patterns (function search_path, security-definer RPC exposure, POS-side `ae_profiles` policies, auth leaked-password setting). The one hardening candidate it surfaced is **now done** (migration `00112`, 2026-07-05): anon EXECUTE revoked on `hr_payrun_is_finalized` (verified: anon RPC → 401 permission denied; authenticated kept — required by the `hr_payslips_select` RLS policy; payslip e2e 19/19 green).
3. **Push** — all work is committed locally only. Awaiting owner go-ahead to push.

## Known follow-ups (P1.5 / P5.4 backlog, non-blocking)

Org chart view, salary/position-history view (data already in `hr_audit_log`), probation-end (119-day) reminders, LINE e-payslip delivery, management roll-up report, onboarding checklist, print buttons. These need external integrations or are polish; core payroll/HR is complete without them.

## Migrations

Schema is file-tracked through `00111`. **Confirmed 2026-07-05:** the live migration history already contains the `00111` content (applied 2026-07-04 as `hr_payslip_deduction_provident_fund` + `hr_payslip_earnings_tip_type`), and a fresh constraint probe matches the file exactly — files and live DB converge; nothing left to apply. `00048_fix_security_definer_view.sql` (already applied live — `v_monthly_violation_count` is `security_invoker=true` and its advisor lint is gone) is now committed for history convergence.
