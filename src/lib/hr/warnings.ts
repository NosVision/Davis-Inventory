import type { SupabaseClient } from '@supabase/supabase-js';

// Shared logic for HR disciplinary warnings (P3.2). Levels deduct from SERVICE
// CHARGE only (the money LINE lands in P4); here we RECORD the intended effect.

export const BUCKET = 'hr-documents';
const PNG_PREFIX = 'data:image/png;base64,';
// ~3MB of base64 (≈ ~2.25MB of PNG) is ample for a hand-drawn signature; cap the
// encoded payload BEFORE decoding so a hostile client can't force a huge decode.
const MAX_SIG_B64 = 3 * 1024 * 1024;

// The six disciplinary levels (§E ladder). Order = severity.
export const LEVELS = [
  'verbal',
  'deduct_25',
  'deduct_50',
  'deduct_100',
  'deduct_200',
  'amount_baht',
] as const;

export type WarningLevel = (typeof LEVELS)[number];

// The three signing parties (§E: employee + manager + HR).
export const SIGNATURE_ROLES = ['employee', 'manager', 'hr'] as const;
export type SignatureRole = (typeof SIGNATURE_ROLES)[number];

export function isWarningLevel(v: unknown): v is WarningLevel {
  return typeof v === 'string' && (LEVELS as readonly string[]).includes(v);
}

export interface ScEffect {
  sc_deduct_percent: number | null;
  amount_satang: number | null;
  sc_deduct_cycles: number;
}

export type DeriveResult =
  | ({ ok: true } & ScEffect)
  | { ok: false; error: string };

// Compute the SC deduction intent from the level SERVER-SIDE — never trust the
// client for these. amount_satang is only accepted (and required) for 'amount_baht';
// for every other level it is forced to null. deduct_200 = SC 2 months (§H carry-forward).
export function deriveScEffect(level: WarningLevel, amountSatang: unknown): DeriveResult {
  switch (level) {
    case 'verbal':
      return { ok: true, sc_deduct_percent: null, amount_satang: null, sc_deduct_cycles: 0 };
    case 'deduct_25':
      return { ok: true, sc_deduct_percent: 25, amount_satang: null, sc_deduct_cycles: 1 };
    case 'deduct_50':
      return { ok: true, sc_deduct_percent: 50, amount_satang: null, sc_deduct_cycles: 1 };
    case 'deduct_100':
      return { ok: true, sc_deduct_percent: 100, amount_satang: null, sc_deduct_cycles: 1 };
    case 'deduct_200':
      return { ok: true, sc_deduct_percent: 200, amount_satang: null, sc_deduct_cycles: 2 };
    case 'amount_baht': {
      if (
        typeof amountSatang !== 'number' ||
        !Number.isInteger(amountSatang) ||
        amountSatang <= 0
      ) {
        return { ok: false, error: 'amount_satang must be a positive integer for level=amount_baht' };
      }
      return { ok: true, sc_deduct_percent: null, amount_satang: amountSatang, sc_deduct_cycles: 1 };
    }
    default:
      return { ok: false, error: 'Invalid level' };
  }
}

export type SignatureDecode =
  | { ok: true; buffer: Buffer }
  | { ok: false; error: string };

// Decode + validate a base64 PNG signature data URL (policies-ack pattern):
// PNG-prefix check → base64 size cap → decode → non-empty → PNG magic bytes.
export function decodeSignaturePng(signature: unknown): SignatureDecode {
  const sig = typeof signature === 'string' ? signature : '';
  if (!sig.startsWith(PNG_PREFIX)) {
    return { ok: false, error: 'signature must be a data:image/png;base64 data URL' };
  }
  const b64 = sig.slice(PNG_PREFIX.length);
  if (b64.length > MAX_SIG_B64) {
    return { ok: false, error: 'Signature too large' };
  }
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0) {
    return { ok: false, error: 'signature is empty' };
  }
  // PNG magic bytes: \x89 P N G
  if (!(buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)) {
    return { ok: false, error: 'signature must be a valid PNG' };
  }
  return { ok: true, buffer };
}

export interface FinalizeResult {
  /** all three roles have now signed */
  acknowledged: boolean;
  /** status was flipped active → acknowledged by THIS call (for audit) */
  flipped: boolean;
}

// After a signature insert, count the distinct signing roles for the warning; once
// all three (employee, manager, HR) are present AND the warning is still 'active',
// flip it to 'acknowledged'. The compare-and-set (`status='active'`) keeps concurrent
// signers from double-flipping. Shared by all three signing routes.
export async function maybeFinalize(
  service: SupabaseClient,
  warningId: string
): Promise<FinalizeResult> {
  const { data: sigs } = await service
    .from('hr_warning_signatures')
    .select('role')
    .eq('warning_id', warningId);

  const roles = new Set((sigs ?? []).map((s) => (s as { role: string }).role));
  const allSigned = SIGNATURE_ROLES.every((r) => roles.has(r));
  if (!allSigned) return { acknowledged: false, flipped: false };

  const { data: flippedRows } = await service
    .from('hr_warnings')
    .update({ status: 'acknowledged' })
    .eq('id', warningId)
    .eq('status', 'active')
    .select('id');

  return { acknowledged: true, flipped: (flippedRows?.length ?? 0) > 0 };
}
