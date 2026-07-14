import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyUser } from '@/lib/notifications/service';
import { formatBaht } from '@/lib/pos/money';

const POOLS = 'hr_sc_pools';
const MAX_MESSAGE_LEN = 500;

// "ประกาศ SV" — manual, never fired by finalize (owner ask 2026-07-15). HR can edit the
// message template per pool; placeholders are swapped PER RECIPIENT at send time.
const DEFAULT_MESSAGE =
  'Service Charge งวด {period} ของคุณ {amount} จะจ่ายวันที่ {payDate} 💰';
const ANNOUNCE_TITLE = 'Service Charge ออกแล้ว 💰';

interface PoolRow {
  id: string;
  store_id: string;
  period_month: string;
  status: string;
  pay_date: string | null;
  announced_at: string | null;
  announced_by: string | null;
  announce_message: string | null;
}

async function loadPool(service: SupabaseClient, poolId: string): Promise<PoolRow | null> {
  const { data } = await service
    .from(POOLS)
    .select('id, store_id, period_month, status, pay_date, announced_at, announced_by, announce_message')
    .eq('id', poolId)
    .maybeSingle();
  return (data as PoolRow | null) ?? null;
}

// 'YYYY-MM-DD' → 'DD/MM/YYYY'
function dmy(d: string | null): string {
  if (!d) return '—';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return y && m && dd ? `${dd}/${m}/${y}` : String(d);
}

function periodLabel(periodMonth: string): string {
  const [y, m] = String(periodMonth).slice(0, 10).split('-');
  return `${m}/${y}`;
}

function fillTemplate(template: string, vars: { period: string; amount: string; payDate: string }): string {
  return template
    .replace(/\{period\}/g, vars.period)
    .replace(/\{amount\}/g, vars.amount)
    .replace(/\{payDate\}/g, vars.payDate);
}

// GET — the announce panel's state: saved template (null = default), the default, last-sent stamp.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  const service = createServiceClient();
  const pool = await loadPool(service, poolId);
  if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });
  const auth = await requireStoreManager(pool.store_id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  return NextResponse.json({
    data: {
      message: pool.announce_message,
      default_message: DEFAULT_MESSAGE,
      announced_at: pool.announced_at,
      pay_date: pool.pay_date,
      status: pool.status,
    },
  });
}

// PUT — save HR's custom message template (empty = reset to default). Audited.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  const service = createServiceClient();
  const pool = await loadPool(service, poolId);
  if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });
  const auth = await requireStoreManager(pool.store_id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as { message?: unknown };
  const raw = typeof body.message === 'string' ? body.message.trim() : '';
  if (raw.length > MAX_MESSAGE_LEN) {
    return NextResponse.json({ error: `Message must be ≤ ${MAX_MESSAGE_LEN} characters` }, { status: 400 });
  }
  const next = raw === '' || raw === DEFAULT_MESSAGE ? null : raw;

  const { error } = await service
    .from(POOLS)
    .update({ announce_message: next, updated_by: auth.userId })
    .eq('id', poolId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: POOLS,
    recordId: poolId,
    before: { announce_message: pool.announce_message },
    after: { announce_message: next },
    reason: 'SC announce message edited',
  });

  return NextResponse.json({ data: { message: next, default_message: DEFAULT_MESSAGE } });
}

// DELETE — reset the template back to the app default. Audited.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  const service = createServiceClient();
  const pool = await loadPool(service, poolId);
  if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });
  const auth = await requireStoreManager(pool.store_id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { error } = await service
    .from(POOLS)
    .update({ announce_message: null, updated_by: auth.userId })
    .eq('id', poolId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: POOLS,
    recordId: poolId,
    before: { announce_message: pool.announce_message },
    after: { announce_message: null },
    reason: 'SC announce message reset to default',
  });

  return NextResponse.json({ data: { message: null, default_message: DEFAULT_MESSAGE } });
}

// POST — send the announcement to everyone with an allocation in this pool. Finalized pools
// only (draft numbers can still move), and re-sending needs an explicit `resend` (mirrors
// the payrun announce double-blast guard). Each recipient gets THEIR net amount.
export async function POST(request: NextRequest, { params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  const service = createServiceClient();
  const pool = await loadPool(service, poolId);
  if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });
  const auth = await requireStoreManager(pool.store_id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (pool.status !== 'finalized') {
    return NextResponse.json({ error: 'Finalize the pool before announcing' }, { status: 409 });
  }
  const body = (await request.json().catch(() => ({}))) as { resend?: unknown };
  if (pool.announced_at && body.resend !== true) {
    return NextResponse.json({ error: 'Already announced — pass resend to send again' }, { status: 409 });
  }

  const { data: allocs, error: allocErr } = await service
    .from('hr_sc_allocations')
    .select('user_id, allocated_satang, deductions:hr_sc_deductions(amount_satang)')
    .eq('pool_id', poolId);
  if (allocErr) return NextResponse.json({ error: 'Failed to load allocations' }, { status: 500 });

  const template = pool.announce_message?.trim() || DEFAULT_MESSAGE;
  const period = periodLabel(pool.period_month);
  const payDate = dmy(pool.pay_date);

  const recipients = (allocs ?? [])
    .filter((a) => Number(a.allocated_satang) > 0)
    .map((a) => {
      const deducted = ((a.deductions ?? []) as { amount_satang: number }[]).reduce(
        (s, d) => s + Number(d.amount_satang || 0),
        0
      );
      const net = Math.max(0, Number(a.allocated_satang) - deducted);
      return { userId: a.user_id as string, net };
    });

  await Promise.allSettled(
    recipients.map((r) =>
      notifyUser({
        userId: r.userId,
        storeId: pool.store_id,
        type: 'hr_sc_ready',
        title: ANNOUNCE_TITLE,
        body: fillTemplate(template, { period, amount: `${formatBaht(r.net)} บาท`, payDate }),
        data: { url: '/me' },
      })
    )
  );

  await service
    .from(POOLS)
    .update({ announced_at: new Date().toISOString(), announced_by: auth.userId })
    .eq('id', poolId);

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: POOLS,
    recordId: poolId,
    before: { announced_at: pool.announced_at },
    after: { announced: true, notified: recipients.length },
    reason: body.resend === true ? 'SC announcement re-sent' : 'SC announcement sent',
  });

  return NextResponse.json({ data: { notified: recipients.length } });
}
