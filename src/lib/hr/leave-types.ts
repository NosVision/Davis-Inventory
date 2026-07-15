// HR leave-type field parsing + validation (P3.1 admin config).
// Shared by POST (create) and PUT (update) so the two routes agree on ranges.

import type { SupabaseClient } from '@supabase/supabase-js';

const CODE_RE = /^[a-z_]+$/;

// ---------------------------------------------------------------------------
// Shared option source — the SINGLE definition of "which leave types can be
// picked" used by every surface (employee filing, HR day-edit, backfill,
// attendance review). ACTIVE only, the company's own types + global
// (company_id IS NULL), ordered by sort_order.
// ---------------------------------------------------------------------------

export interface LeaveTypeOption {
  id: string;
  code: string;
  name_th: string;
  name_en: string;
  company_id: string | null;
  paid: boolean;
  requires_cert: boolean;
  requires_reason: boolean;
  probational_allowed: boolean;
  advance_notice_days: number | null;
}

const OPTION_SELECT =
  'id, code, name_th, name_en, company_id, paid, requires_cert, requires_reason, probational_allowed, advance_notice_days';

/** ACTIVE leave types available to `companyId` (own + global), ordered by sort_order.
 *  Returns null on a query error so callers can 500 rather than silently show none. */
export async function fetchLeaveTypeOptions(
  service: SupabaseClient,
  companyId: string | null
): Promise<LeaveTypeOption[] | null> {
  let query = service.from('hr_leave_types').select(OPTION_SELECT).eq('active', true);
  query = companyId
    ? query.or(`company_id.eq.${companyId},company_id.is.null`)
    : query.is('company_id', null);
  const { data, error } = await query.order('sort_order', { ascending: true });
  if (error) return null;
  return (data ?? []) as LeaveTypeOption[];
}

export interface LeaveTypeFieldResult {
  ok: boolean;
  error?: string;
  /** Sanitized, DB-ready fields (only keys that were present/valid). */
  fields: Record<string, unknown>;
}

/**
 * Parse an optional nullable integer with a range. Returns:
 *   - { skip: true }               → key absent, leave untouched
 *   - { value: null }              → explicitly cleared
 *   - { value: n }                 → a valid integer in range
 *   - { error }                    → present but invalid
 */
function parseNullableInt(
  raw: unknown,
  { min, max }: { min: number; max?: number },
): { skip?: true; value?: number | null; error?: string } {
  if (raw === undefined) return { skip: true };
  if (raw === null || raw === '') return { value: null };
  const n = Number(raw);
  if (!Number.isInteger(n)) return { error: 'must be a whole number' };
  if (n < min) return { error: `must be >= ${min}` };
  if (max !== undefined && n > max) return { error: `must be <= ${max}` };
  return { value: n };
}

/**
 * Validate + collect the editable leave-type fields from a request body.
 * `requireCore` is true on create (code/name_th/name_en are mandatory) and
 * false on update (only present keys are applied; code is never updatable).
 */
export function collectLeaveTypeFields(
  body: Record<string, unknown>,
  requireCore: boolean,
): LeaveTypeFieldResult {
  const fields: Record<string, unknown> = {};

  // code — only on create; immutable afterwards.
  if (requireCore) {
    const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : '';
    if (!code) return { ok: false, error: 'code is required', fields };
    if (!CODE_RE.test(code)) {
      return { ok: false, error: 'code must be lowercase letters and underscores only', fields };
    }
    fields.code = code;
  }

  // name_th / name_en
  if (requireCore || 'name_th' in body) {
    const nameTh = typeof body.name_th === 'string' ? body.name_th.trim() : '';
    if (!nameTh) return { ok: false, error: 'name_th is required', fields };
    fields.name_th = nameTh;
  }
  if (requireCore || 'name_en' in body) {
    const nameEn = typeof body.name_en === 'string' ? body.name_en.trim() : '';
    if (!nameEn) return { ok: false, error: 'name_en is required', fields };
    fields.name_en = nameEn;
  }

  // booleans
  for (const key of ['paid', 'requires_cert', 'requires_reason', 'probational_allowed', 'deduct_sc', 'deduct_travel', 'paid_with_cert'] as const) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') {
        return { ok: false, error: `${key} must be boolean`, fields };
      }
      fields[key] = body[key];
    }
  }
  if (requireCore || 'active' in body) {
    if ('active' in body) {
      if (typeof body.active !== 'boolean') {
        return { ok: false, error: 'active must be boolean', fields };
      }
      fields.active = body.active;
    }
  }

  // sort_order — plain integer, defaults 0 on create.
  if ('sort_order' in body) {
    fields.sort_order = Number(body.sort_order) || 0;
  } else if (requireCore) {
    fields.sort_order = 0;
  }

  // nullable numeric ranges
  const ranges: Array<[string, { min: number; max?: number }]> = [
    ['annual_quota_days', { min: 1 }],
    ['max_consecutive_days', { min: 1 }],
    ['advance_notice_days', { min: 0 }],
    ['paid_percent', { min: 0, max: 100 }],
    ['cert_threshold_days', { min: 0 }],
  ];
  for (const [key, range] of ranges) {
    const parsed = parseNullableInt(body[key], range);
    if (parsed.error) return { ok: false, error: `${key} ${parsed.error}`, fields };
    if (!parsed.skip) fields[key] = parsed.value;
  }

  // On create, when the SC/travel-dock flags aren't specified, default them to the type's paid
  // state: a paid leave docks neither (its day is "earned"), an unpaid leave docks both (it reads
  // as an absence). Keeps new types sensible without forcing HR to set every flag.
  if (requireCore) {
    const paid = fields.paid === undefined ? true : Boolean(fields.paid); // DB default paid = true
    if (fields.deduct_sc === undefined) fields.deduct_sc = !paid;
    if (fields.deduct_travel === undefined) fields.deduct_travel = !paid;
  }

  return { ok: true, fields };
}
