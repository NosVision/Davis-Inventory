import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPosContext, isPosManager } from '@/lib/pos/guard';

const DEFAULTS = {
  service_rate: 0,
  vat_rate: 0,
  vat_inclusive: false,
  service_charge_taxable: true,
  business_day_cutoff_hour: 6,
};

// GET /api/pos/settings?storeId= — ตั้งค่าสาขา (คืน default ถ้ายังไม่เคยตั้ง)
export async function GET(request: NextRequest) {
  const { supabase, user } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const storeId = request.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });
  const { data } = await supabase.from('pos_settings').select('*').eq('store_id', storeId).maybeSingle();
  return NextResponse.json({ settings: data ?? { store_id: storeId, ...DEFAULTS } });
}

interface PutBody {
  storeId?: string;
  serviceRate?: number;
  vatRate?: number;
  vatInclusive?: boolean;
  serviceChargeTaxable?: boolean;
  businessDayCutoffHour?: number;
}

// PUT /api/pos/settings — ตั้งค่ารายสาขา (เจ้าของ/ผู้จัดการ)
export async function PUT(request: NextRequest) {
  const { supabase, user, role } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPosManager(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ' }, { status: 403 });

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });

  const clampRate = (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : 0);
  const { data, error } = await supabase
    .from('pos_settings')
    .upsert(
      {
        store_id: body.storeId,
        service_rate: clampRate(body.serviceRate),
        vat_rate: clampRate(body.vatRate),
        vat_inclusive: !!body.vatInclusive,
        service_charge_taxable: body.serviceChargeTaxable ?? true,
        business_day_cutoff_hour:
          typeof body.businessDayCutoffHour === 'number' ? Math.min(23, Math.max(0, Math.round(body.businessDayCutoffHour))) : 6,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'store_id' },
    )
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
