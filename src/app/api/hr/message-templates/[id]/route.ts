import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';

const TABLE = 'hr_message_templates';
const COLS = 'id, name, body, created_at, updated_at';
const MAX_NAME = 80;
const MAX_BODY = 2000;

// PUT /api/hr/message-templates/[id] { name, body } — edit a template (HR-only).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  const text = typeof body.body === 'string' ? body.body.slice(0, MAX_BODY) : '';
  if (!name || !text.trim()) return NextResponse.json({ error: 'name and body are required' }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .update({ name, body: text, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(COLS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  return NextResponse.json({ data });
}

// DELETE /api/hr/message-templates/[id] — remove a template (HR-only).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const service = createServiceClient();
  const { error } = await service.from(TABLE).delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 });
  return NextResponse.json({ data: { id, removed: true } });
}
