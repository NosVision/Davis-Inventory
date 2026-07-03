import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isUniqueViolation, isForeignKeyViolation } from '@/lib/hr/db-errors';
import { isCalendarDate } from '@/lib/hr/leaves';

const TABLE = 'hr_holidays';
const SELECT = '*, company:hr_companies(id, name)';
const YEAR_RE = /^\d{4}$/;

// GET /api/hr/holidays?company_id=…&year=YYYY — ordered by holiday_date.
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = request.nextUrl.searchParams;
  const companyId = sp.get('company_id');
  const year = sp.get('year');

  const service = createServiceClient();
  let query = service.from(TABLE).select(SELECT);
  if (companyId) query = query.eq('company_id', companyId);
  if (year && YEAR_RE.test(year)) {
    query = query.gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`);
  }
  query = query.order('holiday_date', { ascending: true });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/hr/holidays — create a holiday.
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const holidayDate = typeof body.holiday_date === 'string' ? body.holiday_date.trim() : '';
  if (!isCalendarDate(holidayDate)) {
    return NextResponse.json({ error: 'holiday_date must be a valid YYYY-MM-DD date' }, { status: 400 });
  }
  const nameTh = typeof body.name_th === 'string' ? body.name_th.trim() : '';
  if (!nameTh) return NextResponse.json({ error: 'name_th is required' }, { status: 400 });
  const nameEn = typeof body.name_en === 'string' ? body.name_en.trim() : '';
  if (!nameEn) return NextResponse.json({ error: 'name_en is required' }, { status: 400 });

  const companyId = typeof body.company_id === 'string' && body.company_id ? body.company_id : null;
  const isPublic = typeof body.is_public_holiday === 'boolean' ? body.is_public_holiday : true;

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .insert({
      company_id: companyId,
      holiday_date: holidayDate,
      name_th: nameTh,
      name_en: nameEn,
      is_public_holiday: isPublic,
      active: true,
    })
    .select(SELECT)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'A holiday already exists on this date' }, { status: 409 });
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
