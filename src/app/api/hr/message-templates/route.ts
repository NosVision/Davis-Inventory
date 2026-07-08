import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';

const TABLE = 'hr_message_templates';
const COLS = 'id, name, body, created_at, updated_at';
const MAX_NAME = 80;
const MAX_BODY = 2000;

// GET /api/hr/message-templates — the reusable credential hand-off messages (HR-only).
export async function GET() {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data, error } = await service.from(TABLE).select(COLS).order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/hr/message-templates { name, body } — create a template (HR-only).
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  const text = typeof body.body === 'string' ? body.body.slice(0, MAX_BODY) : '';
  if (!name || !text.trim()) return NextResponse.json({ error: 'name and body are required' }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .insert({ name, body: text, created_by: auth.userId })
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
