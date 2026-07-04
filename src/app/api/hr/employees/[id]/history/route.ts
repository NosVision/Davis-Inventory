import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForEmployeeId } from '@/lib/hr/route-auth';

// GET /api/hr/employees/[id]/history — the salary / position / status edit history for one
// employee (P1.5), read from hr_audit_log's before/after snapshots. Company-HR or a manager whose
// scope covers this employee. Returns only audit rows that actually changed a tracked field, each
// with old→new pairs and position/department ids resolved to names. Read-only.
const TRACKED = ['rate_satang', 'position_id', 'department_id', 'pay_type', 'status', 'start_date', 'sso_enrolled'] as const;

interface AuditRow {
  id: string;
  action: string;
  created_at: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: { display_name: string | null; username: string | null } | null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireHrManagerForEmployeeId(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_audit_log')
    .select('id, action, created_at, reason, before, after, actor:profiles!hr_audit_log_actor_id_fkey(display_name, username)')
    .eq('table_name', 'hr_employees')
    .eq('record_id', id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load history' }, { status: 500 });

  const rows = (data ?? []) as unknown as AuditRow[];

  // Collect every position/department id referenced (old or new) → resolve to names once.
  const refIds = new Set<string>();
  for (const r of rows) {
    for (const src of [r.before, r.after]) {
      const pid = src?.position_id;
      const did = src?.department_id;
      if (typeof pid === 'string') refIds.add(pid);
      if (typeof did === 'string') refIds.add(did);
    }
  }
  const nameById = new Map<string, string>();
  if (refIds.size) {
    const [{ data: pos }, { data: dep }] = await Promise.all([
      service.from('hr_positions').select('id, name').in('id', [...refIds]),
      service.from('hr_departments').select('id, name').in('id', [...refIds]),
    ]);
    for (const p of pos ?? []) nameById.set(p.id as string, p.name as string);
    for (const d of dep ?? []) nameById.set(d.id as string, d.name as string);
  }

  const label = (field: string, v: unknown): string | null => {
    if (v == null) return null;
    if (field === 'position_id' || field === 'department_id') return nameById.get(String(v)) ?? String(v);
    return String(v);
  };

  const events = rows
    .map((r) => {
      const before = r.before ?? {};
      const after = r.after ?? {};
      const changes = TRACKED.flatMap((f) => {
        const ov = (before as Record<string, unknown>)[f];
        const nv = (after as Record<string, unknown>)[f];
        // On create, `before` is null → surface the initial values (skip empties).
        if (r.action === 'create') return nv == null ? [] : [{ field: f, from: null, to: label(f, nv) }];
        if (JSON.stringify(ov) === JSON.stringify(nv)) return [];
        return [{ field: f, from: label(f, ov), to: label(f, nv) }];
      });
      return {
        id: r.id,
        action: r.action,
        created_at: r.created_at,
        reason: r.reason,
        actor_name: r.actor?.display_name || r.actor?.username || '—',
        changes,
      };
    })
    .filter((e) => e.changes.length > 0);

  return NextResponse.json({ data: events });
}
