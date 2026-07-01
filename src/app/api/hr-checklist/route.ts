import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

interface SaveBody {
  sessionId?: string;
  name?: string;
  selectedKeys?: string[];
  selectedCount?: number;
  totalCount?: number;
}

// POST /api/hr-checklist — บันทึกสิ่งที่เจ้าของติ๊กจากหน้า /hr-checklist.html
// เปิดสาธารณะ (หน้า checklist เป็น static ไม่มี login) — เขียนผ่าน service role
export async function POST(request: NextRequest) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const sessionId = (body.sessionId ?? '').trim().slice(0, 80);
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

  const keys = Array.isArray(body.selectedKeys)
    ? body.selectedKeys.slice(0, 300).map((k) => String(k).slice(0, 240))
    : [];

  const svc = createServiceClient();
  const { error } = await svc.from('hr_checklist_responses').upsert(
    {
      session_id: sessionId,
      respondent_name: body.name ? String(body.name).slice(0, 120) : null,
      selected_keys: keys,
      selected_count: typeof body.selectedCount === 'number' ? body.selectedCount : keys.length,
      total_count: typeof body.totalCount === 'number' ? Math.max(0, Math.round(body.totalCount)) : 0,
      user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'session_id' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// GET /api/hr-checklist — ดูรายการที่เจ้าของเลือก (ต้องล็อกอินในแอปก่อน)
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('hr_checklist_responses')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ responses: data ?? [] });
}
