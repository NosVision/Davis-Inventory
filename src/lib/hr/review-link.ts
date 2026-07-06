import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// Accountant review-link plumbing (owner plan 2026-07-06). The raw token is the entire
// credential: 24 random bytes, base64url in the URL, only its SHA-256 stored. Links expire,
// can be revoked, and writes are further bounded by the payrun being draft.

export const REVIEW_LINK_TTL_DAYS = 14;

export function newReviewToken(): string {
  return randomBytes(24).toString('base64url');
}
export function hashReviewToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface ReviewLinkRow {
  id: string;
  payrun_id: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  accessed_at: string | null;
  saved_at: string | null;
  passcode: string;
}

export const DEFAULT_REVIEW_PASSCODE = '1234';
/** normalize a passcode input; valid = 4–12 chars, digits/letters only */
export function normalizePasscode(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  return /^[a-zA-Z0-9]{4,12}$/.test(s) ? s : null;
}

export interface ReviewPayrun {
  id: string;
  status: string;
  store_id: string | null;
  period_year: number;
  period_month: number;
  cycle_start: string | null;
  cycle_end: string | null;
  pay_date: string | null;
  company: { name: string | null; address: string | null } | null;
}

export type LoadLinkResult =
  | { ok: true; link: ReviewLinkRow; payrun: ReviewPayrun }
  | { ok: false; status: number; error: string };

export async function loadReviewLink(service: SupabaseClient, rawToken: string): Promise<LoadLinkResult> {
  if (!rawToken || rawToken.length < 16 || rawToken.length > 64) {
    return { ok: false, status: 401, error: 'Invalid link' };
  }
  const { data: link, error } = await service
    .from('hr_payrun_review_links')
    .select('id, payrun_id, created_by, created_at, expires_at, revoked_at, accessed_at, saved_at, passcode')
    .eq('token_hash', hashReviewToken(rawToken))
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: 'Failed to check link' };
  if (!link) return { ok: false, status: 401, error: 'Invalid link' };
  if (link.revoked_at) return { ok: false, status: 410, error: 'Link revoked' };
  if (new Date(link.expires_at as string).getTime() < Date.now()) {
    return { ok: false, status: 410, error: 'Link expired' };
  }

  const { data: payrun, error: prErr } = await service
    .from('hr_payruns')
    .select('id, status, store_id, period_year, period_month, cycle_start, cycle_end, pay_date, company:hr_companies(name, address)')
    .eq('id', link.payrun_id)
    .maybeSingle();
  if (prErr || !payrun) return { ok: false, status: 404, error: 'Payrun not found' };

  return { ok: true, link: link as ReviewLinkRow, payrun: payrun as unknown as ReviewPayrun };
}

export interface ReviewRow {
  payslip_id: string;
  name: string;
  employee_code: string | null;
  pay_type: string;
  tax_mode: string;
  salary_satang: number;
  ot_satang: number;
  allowance_satang: number; // recurring allowances + other earnings (excl salary/ot/SC/tip)
  sc_satang: number; // service charge + tip
  gross_satang: number;
  deduction_satang: number; // non-statutory deductions (late/absent/leave/recurring)
  sso_satang: number;
  tax_satang: number; // current effective tax (engine estimate or override)
  has_override: boolean;
  net_satang: number;
}

/** Assemble the accountant-facing rows for a payrun — everything the Payment file showed. */
export async function buildPayrunReviewRows(service: SupabaseClient, payrunId: string): Promise<ReviewRow[] | null> {
  const { data: slips, error: slipErr } = await service
    .from('hr_payslips')
    .select('id, user_id, employee_id, pay_type, tax_mode, gross_satang, sso_satang, tax_satang, total_deduction_satang, net_satang')
    .eq('payrun_id', payrunId);
  if (slipErr) return null;
  const slipList = slips ?? [];
  if (slipList.length === 0) return [];

  const slipIds = slipList.map((s) => s.id as string);
  const userIds = [...new Set(slipList.map((s) => s.user_id as string))];
  const empIds = [...new Set(slipList.map((s) => s.employee_id as string).filter(Boolean))];

  const [earnRes, profRes, empRes, ovrRes] = await Promise.all([
    service.from('hr_payslip_earnings').select('payslip_id, type, amount_satang').in('payslip_id', slipIds),
    service.from('profiles').select('id, username, display_name').in('id', userIds),
    empIds.length
      ? service.from('hr_employees').select('id, employee_code, full_name').in('id', empIds)
      : Promise.resolve({ data: [], error: null } as { data: { id: string; employee_code: string | null; full_name: string | null }[]; error: null }),
    service.from('hr_payslip_tax_overrides').select('profile_id').eq('payrun_id', payrunId),
  ]);
  if (earnRes.error) return null;

  const profById = new Map((profRes.data ?? []).map((p) => [p.id as string, p]));
  if ('error' in empRes && empRes.error) return null;
  const empById = new Map(((empRes.data ?? []) as { id: string; employee_code: string | null; full_name: string | null }[]).map((e) => [e.id, e]));
  const overridden = new Set(((ovrRes.data ?? []) as { profile_id: string }[]).map((o) => o.profile_id));

  const earnBySlip = new Map<string, { type: string; amount_satang: number }[]>();
  for (const e of (earnRes.data ?? []) as { payslip_id: string; type: string; amount_satang: number }[]) {
    const list = earnBySlip.get(e.payslip_id) ?? [];
    list.push(e);
    earnBySlip.set(e.payslip_id, list);
  }

  const rows: ReviewRow[] = slipList.map((s) => {
    const earns = earnBySlip.get(s.id as string) ?? [];
    const sum = (pred: (t: string) => boolean) => earns.filter((e) => pred(e.type)).reduce((a, e) => a + e.amount_satang, 0);
    const salary = sum((t) => t === 'salary');
    const ot = sum((t) => t === 'ot');
    const sc = sum((t) => t === 'service_charge' || t === 'tip');
    const allowance = sum((t) => !['salary', 'ot', 'service_charge', 'tip'].includes(t));
    const prof = profById.get(s.user_id as string);
    const emp = empById.get(s.employee_id as string);
    const sso = Number(s.sso_satang) || 0;
    const tax = Number(s.tax_satang) || 0;
    return {
      payslip_id: s.id as string,
      name: emp?.full_name || prof?.display_name || prof?.username || '—',
      employee_code: emp?.employee_code ?? null,
      pay_type: s.pay_type as string,
      tax_mode: s.tax_mode as string,
      salary_satang: salary,
      ot_satang: ot,
      allowance_satang: allowance,
      sc_satang: sc,
      gross_satang: Number(s.gross_satang) || 0,
      deduction_satang: Number(s.total_deduction_satang) - sso - tax,
      sso_satang: sso,
      tax_satang: tax,
      has_override: overridden.has(s.user_id as string),
      net_satang: Number(s.net_satang) || 0,
    };
  });

  rows.sort((a, b) => (a.employee_code ?? '~').localeCompare(b.employee_code ?? '~') || a.name.localeCompare(b.name, 'th'));
  return rows;
}
