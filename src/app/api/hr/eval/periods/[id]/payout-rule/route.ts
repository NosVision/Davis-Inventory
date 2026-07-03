import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const RULES = 'hr_eval_payout_rules';
const TIERS = 'hr_eval_payout_tiers';

// The score→money rule for a period (§G): one rule per period (v1). linear = flat + per-pct;
// tiered = a set of [min_pct, max_pct] bands with an amount (may be NEGATIVE = หักจาก SC).
// HR-managed. GET returns the rule + its tiers (sorted); PUT upserts the rule and replaces the
// tier set atomically-ish (delete + insert) so the tiers always match the current rule shape.

interface TierInput {
  min_pct: number;
  max_pct: number;
  amount_satang: number;
  label: string | null;
  sort_order: number;
}

function parseTiers(raw: unknown): { ok: true; tiers: TierInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'tiers must be an array' };
  const tiers: TierInput[] = [];
  raw.forEach((item, i) => {
    const t = item as Record<string, unknown>;
    const min = Number(t.min_pct);
    const max = Number(t.max_pct);
    const amount = Number(t.amount_satang);
    if (![min, max].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) throw new Error('tier pct must be 0..100');
    if (max < min) throw new Error('tier max_pct must be >= min_pct');
    if (!Number.isInteger(amount)) throw new Error('tier amount_satang must be an integer');
    tiers.push({
      min_pct: min, max_pct: max, amount_satang: amount,
      label: typeof t.label === 'string' ? t.label.slice(0, 100) : null,
      sort_order: Number.isFinite(Number(t.sort_order)) ? Number(t.sort_order) : i,
    });
  });
  return { ok: true, tiers };
}

// GET /api/hr/eval/periods/[id]/payout-rule — the rule + tiers for a period.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const service = createServiceClient();
  const { data: rule, error } = await service.from(RULES).select('*').eq('period_id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rule) return NextResponse.json({ data: null });
  const { data: tiers } = await service.from(TIERS).select('*').eq('rule_id', rule.id).order('sort_order');
  return NextResponse.json({ data: { rule, tiers: tiers ?? [] } });
}

// PUT /api/hr/eval/periods/[id]/payout-rule — upsert the rule + replace its tiers.
// body { formula_type, flat_satang?, satang_per_pct?, tiers?:[{min_pct,max_pct,amount_satang,label,sort_order}] }
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const formulaType = body.formula_type === 'linear' ? 'linear' : body.formula_type === 'tiered' ? 'tiered' : '';
  if (!formulaType) return NextResponse.json({ error: 'formula_type must be linear or tiered' }, { status: 400 });
  const flatSatang = Number.isInteger(Number(body.flat_satang)) ? Number(body.flat_satang) : 0;
  const satangPerPct = Number.isInteger(Number(body.satang_per_pct)) ? Number(body.satang_per_pct) : 0;

  let tiers: TierInput[] = [];
  if (formulaType === 'tiered') {
    let parsed;
    try {
      parsed = parseTiers(body.tiers);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'invalid tiers' }, { status: 400 });
    }
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    tiers = parsed.tiers;
    if (tiers.length === 0) return NextResponse.json({ error: 'a tiered rule needs at least one tier' }, { status: 400 });
  }

  const service = createServiceClient();

  // upsert the rule (unique on period_id)
  const { data: rule, error } = await service
    .from(RULES)
    .upsert({ period_id: id, formula_type: formulaType, flat_satang: flatSatang, satang_per_pct: satangPerPct }, { onConflict: 'period_id' })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // replace tiers: clear then insert the new set
  await service.from(TIERS).delete().eq('rule_id', rule.id);
  if (tiers.length) {
    const rows = tiers.map((t) => ({ ...t, rule_id: rule.id }));
    const { error: tErr } = await service.from(TIERS).insert(rows);
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: RULES, recordId: rule.id as string,
    before: null, after: { rule, tier_count: tiers.length }, reason: 'evaluation payout rule set',
  });
  return NextResponse.json({ data: { rule, tier_count: tiers.length } });
}
