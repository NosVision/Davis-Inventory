import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { TASK_BOT_TOKEN_KEY, TASK_BOT_SECRET_KEY } from '@/lib/line/tasks-bot';

// Central task-bot credentials (owner only). The raw token/secret are NEVER returned to the client
// — GET reports only whether each is set. Saved to system_settings via the service client.

async function requireOwner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'owner') return { ok: false as const, status: 403, error: 'เฉพาะเจ้าของร้านเท่านั้น' };
  return { ok: true as const };
}

// GET — configured state only (no secrets leave the server).
export async function GET() {
  const auth = await requireOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data } = await service.from('system_settings').select('key, value').in('key', [TASK_BOT_TOKEN_KEY, TASK_BOT_SECRET_KEY]);
  const map = new Map((data ?? []).map((r) => [r.key as string, ((r.value as string | null) ?? '').trim()]));
  return NextResponse.json({
    token_set: !!map.get(TASK_BOT_TOKEN_KEY),
    secret_set: !!map.get(TASK_BOT_SECRET_KEY),
  });
}

// PUT — save token/secret. Empty string clears a value; an absent key is left untouched.
export async function PUT(request: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as { token?: unknown; secret?: unknown };
  const rows: { key: string; value: string }[] = [];
  if (typeof body.token === 'string') rows.push({ key: TASK_BOT_TOKEN_KEY, value: body.token.trim() });
  if (typeof body.secret === 'string') rows.push({ key: TASK_BOT_SECRET_KEY, value: body.secret.trim() });
  if (rows.length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

  const service = createServiceClient();
  const { error } = await service.from('system_settings').upsert(rows, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
