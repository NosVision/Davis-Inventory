import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyStoreStaff } from '@/lib/notifications/service';

interface CreateBody {
  storeId: string;
  title: string;
  description?: string;
  location?: string;
  priority?: 'normal' | 'urgent';
  photoUrls?: string[];
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!body.storeId || !title) {
    return NextResponse.json({ error: 'กรุณาระบุสาขาและหัวข้อการแจ้งซ่อม' }, { status: 400 });
  }

  const priority = body.priority === 'urgent' ? 'urgent' : 'normal';
  const photoUrls = Array.isArray(body.photoUrls)
    ? body.photoUrls.filter((u) => typeof u === 'string' && u.length > 0)
    : [];

  // Insert under the user's RLS context — guarantees they can only file a
  // repair for a store they belong to.
  const { data: repair, error } = await supabase
    .from('repair_requests')
    .insert({
      store_id: body.storeId,
      title,
      description: body.description?.trim() || null,
      location: body.location?.trim() || null,
      priority,
      photo_urls: photoUrls,
      status: 'pending',
      reported_by: user.id,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve branch name so multi-store technicians know which branch.
  const { data: store } = await supabase
    .from('stores')
    .select('store_name')
    .eq('id', body.storeId)
    .maybeSingle();
  const storeName = (store as { store_name?: string } | null)?.store_name || '';

  // Notify technicians + managers of the store (in-app + push + LINE).
  await notifyStoreStaff({
    storeId: body.storeId,
    type: 'repair_new',
    title: `🔧 แจ้งซ่อมใหม่${storeName ? ` · ${storeName}` : ''}`,
    body: `${title}${body.location ? ` (${body.location})` : ''}`,
    data: { repairId: repair.id, url: `/repairs/${repair.id}`, storeName },
    roles: ['technician', 'manager'],
    excludeUserId: user.id,
  });

  // Audit (non-fatal)
  try {
    const svc = createServiceClient();
    await svc.from('audit_logs').insert({
      store_id: body.storeId,
      action_type: 'REPAIR_CREATED',
      table_name: 'repair_requests',
      new_value: { repair_id: repair.id, title, priority },
      changed_by: user.id,
    });
  } catch {
    // ignore audit failures
  }

  return NextResponse.json({ repair });
}
