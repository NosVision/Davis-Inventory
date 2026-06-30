# POS subsystem — build guide for Claude

This route group `(pos)` holds the new POS / order-taking / BOM / waste system.
**Full plan & decisions: [`docs/pos/PLAN.md`](../../../docs/pos/PLAN.md). Read it before building.**
Status: design phase, pilot 1 store. Offline strategy NOT yet locked — flag before committing to it.

## What to reuse (do NOT reinvent)
- **DB**: same Supabase project as the rest of the app (ref `oogyjqywuqmutkjnnsik`). No separate DB.
- **Supabase clients**: `@/lib/supabase/client` (browser), `@/lib/supabase/server` (`createClient` = user/RLS, `createServiceClient` = service role, **server-only**).
- **Auth/roles**: `@/stores/auth-store` (`useAuthStore`); roles `owner|manager|accountant|bar|technician|staff`.
- **Stores/branches**: table `stores` (`store_name`, `active`).
- **UI kit**: `@/components/ui` (Modal, Button, Input, Select, Textarea, toast). Match existing Tailwind v4 + Thai UI copy.
- **Printing + cash drawer**: existing local print agent (`print_queue` + `RawPrint.ps1`). Do not build a new print path.

## Architecture rules (hard)
1. **Offline-first**: a sale must never block on the network. Cash works offline; card/QR (Beam) require internet for authorization — gate only those.
2. **Outbox / event-log** *(leaning, pending decision)*: writes = append-only immutable events with a **client-generated ULID** + idempotency key; queue in IndexedDB; flush to Supabase; apply **idempotently** server-side. Never depend on server autoincrement for an offline-created row.
3. **Money = integers (satang)**. Never floats. A posted order is immutable — correct by appending a new event (void/refund), never mutate.
4. **Table = pointer, not bill**: moving a table = reassign `pos_orders.table_id` (emit `table_moved`). Enforce **table ownership** (one terminal owns an open table) to avoid offline write conflicts.
5. **Cash drawer**: drawer-kick bytes `1B 70 00 19 FA` go through the **raw ESC/POS path (`RawPrint.ps1`)**, NOT the HTML→PDF path (it strips ESC/POS).
6. **RLS first**: all POS tables get RLS scoped by `store_id`/role. `createServiceClient` only in server routes, never shipped to the client.
7. **BOM**: selling a menu item deducts ingredients via `recipes` against the existing stock tables — reuse stock decrement logic, don't fork it.

## Conventions
- Thai UI labels (match the rest of the app). Keep technical enum words out of user-facing copy.
- TypeScript: explicit types on exported APIs, no `any`, validate input at boundaries (Zod).
- Small files (<800 lines), feature-folder organization.
- Get `tsc --noEmit` green before committing. Conventional commits (`feat(pos): ...`). No attribution footer.
- Hardware (drawer/printer) must be tested against the real device per model — don't claim it works unverified.

## Open questions before coding (see PLAN.md §8)
Net-drop duration · #terminals/store · concurrent same-table edits · Easy Restaurant MySQL schema (for migration) · Beam integration mode (Paired vs Deep-link).
