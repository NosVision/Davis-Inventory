import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logHrAudit } from '@/lib/hr/audit';
import { isUniqueViolation } from '@/lib/hr/db-errors';

const TABLE = 'hr_profile_change_requests';
const FIELD_KEYS = ['bank_account', 'emergency_contact', 'full_name'];

// The legal ชื่อ-นามสกุล is what lands on ภ.ง.ด.1 / สปส. / ใบ 50 ทวิ and the bank-transfer file,
// so it is never self-editable — it takes the same request→approve→apply path as bank details.
const MAX_FULL_NAME = 120;

const COLS =
  'id, user_id, field_key, current_value, new_value, reason, status, approver_id, ' +
  'decided_at, decision_note, applied, created_at, updated_at';

const ACCOUNT_NO_RE = /^[0-9-]{6,20}$/;

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

// Mask a bank account number to its last 4 digits (mirrors /api/hr/ess/profile). The
// snapshotted current_value is returned to the employee (POST 201 + own GET), so storing the
// full number there would defeat the P0 masking gate — mask it before it is ever persisted.
function maskAccountNo(no: string | null | undefined): string | null {
  if (!no) return null;
  const digits = no.replace(/\D/g, '');
  if (digits.length <= 4) return '••••';
  return `••••${digits.slice(-4)}`;
}

// Validate the requested new_value against the field's shape. Returns a normalized
// object on success, or an error message string.
function validateNewValue(
  fieldKey: string,
  raw: unknown
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'new_value must be an object' };
  const v = raw as Record<string, unknown>;

  if (fieldKey === 'bank_account') {
    if (!nonEmptyString(v.bank_name) || !nonEmptyString(v.bank_account_no) || !nonEmptyString(v.bank_account_name)) {
      return { ok: false, error: 'bank_name, bank_account_no, and bank_account_name are required' };
    }
    if (!ACCOUNT_NO_RE.test(v.bank_account_no.trim())) {
      return { ok: false, error: 'bank_account_no must be 6-20 digits' };
    }
    return {
      ok: true,
      value: {
        bank_name: v.bank_name.trim(),
        bank_account_no: v.bank_account_no.trim(),
        bank_account_name: v.bank_account_name.trim(),
      },
    };
  }

  if (fieldKey === 'full_name') {
    if (!nonEmptyString(v.full_name)) return { ok: false, error: 'full_name is required' };
    const name = v.full_name.trim().replace(/\s+/g, ' ');
    if (name.length > MAX_FULL_NAME) {
      return { ok: false, error: `full_name must be ${MAX_FULL_NAME} characters or fewer` };
    }
    return { ok: true, value: { full_name: name } };
  }

  // emergency_contact
  if (!nonEmptyString(v.name) || !nonEmptyString(v.phone)) {
    return { ok: false, error: 'name and phone are required' };
  }
  const value: Record<string, unknown> = { name: v.name.trim(), phone: v.phone.trim() };
  if (nonEmptyString(v.relation)) value.relation = v.relation.trim();
  return { ok: true, value };
}

// POST /api/hr/ess/profile-change-requests — an employee files a change request for one
// of their OWN sensitive profile fields (§J6). Auth-any: the caller is always the subject.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const fieldKey = typeof body.field_key === 'string' ? body.field_key : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null;

  if (!FIELD_KEYS.includes(fieldKey)) {
    return NextResponse.json({ error: `field_key must be one of ${FIELD_KEYS.join(', ')}` }, { status: 400 });
  }

  const validated = validateNewValue(fieldKey, body.new_value);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const service = createServiceClient();

  // The caller must be a registered employee — the current value snapshot comes from it.
  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .select('bank_name, bank_account_no, bank_account_name, emergency_contact, full_name')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to load employee' }, { status: 500 });
  if (!emp) return NextResponse.json({ error: 'You are not a registered employee' }, { status: 400 });

  const currentValue =
    fieldKey === 'bank_account'
      ? {
          bank_name: (emp.bank_name as string | null) ?? null,
          // masked — the snapshot is echoed back to the employee, so never store the full no.
          bank_account_no: maskAccountNo(emp.bank_account_no as string | null),
          bank_account_name: (emp.bank_account_name as string | null) ?? null,
        }
      : fieldKey === 'full_name'
        ? { full_name: (emp.full_name as string | null) ?? null }
        : (emp.emergency_contact ?? null);

  const { data, error } = await service
    .from(TABLE)
    .insert({
      user_id: user.id,
      field_key: fieldKey,
      current_value: currentValue,
      new_value: validated.value,
      reason,
      status: 'pending',
    })
    .select(COLS)
    .single();
  if (error) {
    // Partial-unique index: one open (pending) request per field per user.
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: 'You already have a pending change request for this field' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Failed to file change request' }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: user.id,
    action: 'create',
    table: TABLE,
    recordId: (data as unknown as { id: string }).id,
    after: data as unknown as Record<string, unknown>,
    reason: `Profile change requested: ${fieldKey}`,
  });

  return NextResponse.json({ data }, { status: 201 });
}

// GET /api/hr/ess/profile-change-requests — the caller's own requests, newest first.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .select(COLS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load change requests' }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
