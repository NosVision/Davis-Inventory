import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForEmployeeId } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const BUCKET = 'avatars';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB (bucket also enforces)
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// POST /api/hr/employees/[id]/avatar (multipart: file) — P1.5: set the employee's profile photo.
// Uploads to the PUBLIC avatars bucket keyed by profiles.id and points profiles.avatar_url at it
// (the same field LINE-auth avatars use, so headers/chat/lists pick it up unchanged). Replaces
// any previous photo in the bucket; scoped like every employee mutation.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireHrManagerForEmployeeId(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: `Unsupported type ${file.type}` }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'File exceeds 5MB' }, { status: 400 });

  const service = createServiceClient();
  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .select('id, profile_id, profile:profiles!hr_employees_profile_id_fkey(avatar_url)')
    .eq('id', id)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to load employee' }, { status: 500 });
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  const profileId = emp.profile_id as string;
  const prevUrl = (emp.profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${profileId}/${Date.now()}.${ext}`; // timestamped → new URL busts <img> caches

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await service.storage.from(BUCKET).upload(path, buffer, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: pub } = service.storage.from(BUCKET).getPublicUrl(path);
  const url = pub.publicUrl;

  const { error: profErr } = await service.from('profiles').update({ avatar_url: url }).eq('id', profileId);
  if (profErr) {
    await service.storage.from(BUCKET).remove([path]).catch(() => {});
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  // Best-effort: drop the previous file when it lived in this bucket (LINE URLs are external).
  const marker = `/object/public/${BUCKET}/`;
  if (prevUrl && prevUrl.includes(marker)) {
    const prevPath = decodeURIComponent(prevUrl.split(marker)[1] ?? '');
    if (prevPath && prevPath !== path) {
      await service.storage.from(BUCKET).remove([prevPath]).catch(() => {});
    }
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: 'profiles',
    recordId: profileId,
    before: { avatar_url: prevUrl },
    after: { avatar_url: url },
    reason: 'Employee avatar updated',
  });

  return NextResponse.json({ data: { avatar_url: url } }, { status: 201 });
}
