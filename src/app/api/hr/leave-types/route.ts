import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isUniqueViolation, isForeignKeyViolation } from '@/lib/hr/db-errors';
import { collectLeaveTypeFields } from '@/lib/hr/leave-types';

const TABLE = 'hr_leave_types';
const SELECT = '*, company:hr_companies(id, name)';

// GET /api/hr/leave-types?company_id=… — all types (active + inactive) for config.
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const companyId = request.nextUrl.searchParams.get('company_id');

  const service = createServiceClient();
  let query = service.from(TABLE).select(SELECT);
  if (companyId) query = query.eq('company_id', companyId);
  query = query.order('sort_order', { ascending: true }).order('code', { ascending: true });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/hr/leave-types — create a leave type.
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const parsed = collectLeaveTypeFields(body, true);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const companyId = typeof body.company_id === 'string' && body.company_id ? body.company_id : null;

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .insert({
      ...parsed.fields,
      company_id: companyId,
      active: parsed.fields.active ?? true,
      created_by: auth.userId,
      updated_by: auth.userId,
    })
    .select(SELECT)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'A leave type with this code already exists' }, { status: 409 });
    }
    if (isForeignKeyViolation(error)) {
      return NextResponse.json({ error: 'Invalid company' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: TABLE,
    recordId: data.id,
    before: null,
    after: data,
  });

  return NextResponse.json({ data }, { status: 201 });
}
