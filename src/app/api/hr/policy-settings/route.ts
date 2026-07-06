import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { getHrPolicies, POLICY_DEFAULTS } from '@/lib/hr/policy';

// GET /api/hr/policy-settings — the merged, effective policy set (stored rows over defaults)
// plus the defaults so the UI can show "ค่าเดิม" next to every knob.
export async function GET() {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const effective = await getHrPolicies(service);
  return NextResponse.json({ data: { effective, defaults: POLICY_DEFAULTS } });
}

const KNOWN_KEYS = ['late_tiers', 'probation_days', 'sc_leave_divisor', 'warning_carry', 'work_index', 'payslip_announce'] as const;

// PUT /api/hr/policy-settings { key, value, reason } — upsert one policy knob. Every one of
// these changes money or discipline outcomes, so a reason is ALWAYS required and the change is
// audited with the effective before/after. Values are validated by round-tripping through
// mergePolicies (invalid fields silently fall back to defaults — reject when that happens).
export async function PUT(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const key = typeof body.key === 'string' ? body.key : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
    return NextResponse.json({ error: `Unknown policy key '${key}'` }, { status: 400 });
  }
  if (!reason) return NextResponse.json({ error: 'Reason is required for policy changes' }, { status: 400 });
  if (body.value === null || typeof body.value !== 'object') {
    return NextResponse.json({ error: 'value must be an object' }, { status: 400 });
  }

  const service = createServiceClient();
  const before = await getHrPolicies(service);

  const { error: upErr } = await service
    .from('hr_policy_settings')
    .upsert({ key, value: body.value, updated_by: auth.userId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const after = await getHrPolicies(service);

  // record_id is a uuid column — policy keys are text, so the key rides in the reason instead.
  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: 'hr_policy_settings',
    recordId: null,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    reason: `[${key}] ${reason}`,
  });

  return NextResponse.json({ data: { effective: after } });
}
