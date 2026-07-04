# HR live-auth e2e suites

Black-box e2e for the HR payroll surface that exercise the **real auth + RLS layers** (which a
service-role DB round-trip cannot). Each suite signs in as a real test user via `@supabase/ssr`'s
cookie-jar and replays the resulting `sb-*-auth-token` cookies against the running Next API routes.

## Prerequisites (all machine-local, none committed)

1. **Dev server running** — `npm run dev` (Next 16 Turbopack; self-startable). Base URL defaults to
   `http://localhost:3000`, override with `HR_E2E_BASE`.
2. **`.env.local`** with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`.
3. **Test creds JSON** at `$HR_TEST_CREDS` (default `F:/tmp/hr-test-creds.json`) — holds the test
   users' passwords. **Never commit this file.** Shape: `{ store, users: [{ username, email,
   password, role, id, canManageHr, emp }] }`.

## Run

```
node scripts/hr-e2e/run-all.cjs      # all suites, sequential (they mutate shared test data)
node scripts/hr-e2e/pvd.cjs          # a single suite
```

Suites are **self-restoring**: each cleans up (reopen payrun / restore rate / delete pool) so the
test tenant is left as found. They must run **serially** — never in parallel — because they share
the `2026-07` draft payrun.

## Coverage

| Suite | What it proves |
|-------|----------------|
| `p43` | payrun generate → detail → **ESS draft-hidden** → finalize → **self-scoped** ESS → staff 403 → already-finalized 409 → reopen |
| `tax-allowance` | ล.ย.01 CRUD → **progressive PND1 tax drops** (temp taxable rate, restored) → sensitive-edit reason guard → staff 403 |
| `bank-file` | BBL CSV: draft 409 → finalized export (count/total/skipped headers, total = non-skipped net) → staff 403 |
| `pvd` | `provident_fund` deduction line: enroll 3% → **net drops by the exact line amount** → disenroll removes it |
| `tip-pool` | pool → alloc → deduction (net = allocated − deducted) → **`tip` earning line on the slip** → finalize 409 → staff 403 |

`pvd` + `tip-pool` also guard the payslip line-type CHECK constraints reconciled in migration
`00111` (a fresh DB rebuild that dropped `provident_fund`/`tip` would fail these suites loudly).
