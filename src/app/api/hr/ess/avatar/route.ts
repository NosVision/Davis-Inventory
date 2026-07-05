import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logHrAudit } from '@/lib/hr/audit';

const BUCKET = 'avatars';
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// POST /api/hr/ess/avatar (multipart: file) — self-service profile photo (owner ask
// 2026-07-05): every user can set their own picture from /me/profile. Same bucket, limits
// and replace-and-clean behaviour as the HR-side employee avatar route, but strictly the
// caller's own profiles row.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: `Unsupported type ${file.type}` }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'File exceeds 5MB' }, { status: 400 });

  const service = createServiceClient();
  const { data: prof } = await service.from('profiles').select('avatar_url').eq('id', user.id).maybeSingle();
  const prevUrl = (prof?.avatar_url as string | null) ?? null;

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${user.id}/${Date.now()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await service.storage.from(BUCKET).upload(path, buffer, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: pub } = service.storage.from(BUCKET).getPublicUrl(path);
  const url = pub.publicUrl;

  const { error: profErr } = await service.from('profiles').update({ avatar_url: url }).eq('id', user.id);
  if (profErr) {
    await service.storage.from(BUCKET).remove([path]).catch(() => {});
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  const marker = `/object/public/${BUCKET}/`;
  if (prevUrl && prevUrl.includes(marker)) {
    const prevPath = decodeURIComponent(prevUrl.split(marker)[1] ?? '');
    if (prevPath && prevPath !== path) {
      await service.storage.from(BUCKET).remove([prevPath]).catch(() => {});
    }
  }

  await logHrAudit(service, {
    actorId: user.id,
    action: 'update',
    table: 'profiles',
    recordId: user.id,
    before: { avatar_url: prevUrl },
    after: { avatar_url: url },
    reason: 'Self-service avatar update',
  });

  return NextResponse.json({ data: { avatar_url: url } }, { status: 201 });
}
