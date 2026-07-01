import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// state ร่วมทุกเครื่องอยู่ใน row เดียว (sync ข้ามเครื่อง)
const SHARED_ID = 'shared-checklist';

interface SaveBody {
  sessionId?: string;
  name?: string;
  selectedIndices?: number[];
  selectedKeys?: string[];
  selectedCount?: number;
  totalCount?: number;
}

// POST /api/hr-checklist — บันทึกสถานะเช็คลิสต์ (สาธารณะ; จากหน้า /hr-checklist.html)
// หน้า checklist ใช้ sessionId = 'shared-checklist' เสมอ → ทุกเครื่องเขียน row เดียวกัน
export async function POST(request: NextRequest) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const sessionId = (body.sessionId ?? '').trim().slice(0, 80);
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

  const indices = Array.isArray(body.selectedIndices)
    ? [...new Set(body.selectedIndices.filter((n) => Number.isInteger(n) && n >= 0 && n < 1000))].slice(0, 1000)
    : [];
  const keys = Array.isArray(body.selectedKeys)
    ? body.selectedKeys.slice(0, 300).map((k) => String(k).slice(0, 240))
    : [];

  const svc = createServiceClient();
  const { error } = await svc.from('hr_checklist_responses').upsert(
    {
      session_id: sessionId,
      respondent_name: body.name ? String(body.name).slice(0, 120) : null,
      selection_map: indices,
      selected_keys: keys,
      selected_count: typeof body.selectedCount === 'number' ? body.selectedCount : indices.length,
      total_count: typeof body.totalCount === 'number' ? Math.max(0, Math.round(body.totalCount)) : 0,
      user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'session_id' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// GET /api/hr-checklist
//   ?shared=1  → สถานะร่วม (public) สำหรับ sync ข้ามเครื่อง
//   (ไม่มี param) → รายการทั้งหมด (ต้องล็อกอิน) สำหรับทีม
export async function GET(request: NextRequest) {
  const svc = createServiceClient();

  if (request.nextUrl.searchParams.get('shared')) {
    const { data } = await svc
      .from('hr_checklist_responses')
      .select('selection_map, selected_count, total_count, respondent_name, updated_at')
      .eq('session_id', SHARED_ID)
      .maybeSingle();
    const row = data as {
      selection_map: number[] | null;
      selected_count: number;
      total_count: number;
      respondent_name: string | null;
      updated_at: string;
    } | null;
    return NextResponse.json({
      selectedIndices: row?.selection_map ?? null,
      selectedCount: row?.selected_count ?? 0,
      totalCount: row?.total_count ?? 0,
      name: row?.respondent_name ?? null,
      updatedAt: row?.updated_at ?? null,
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await svc
    .from('hr_checklist_responses')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ responses: data ?? [] });
}
