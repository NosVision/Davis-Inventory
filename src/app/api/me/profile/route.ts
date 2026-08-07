import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

/**
 * PATCH /api/me/profile — the caller edits their OWN account fields (ชื่อเล่น, รูปโปรไฟล์).
 *
 * Why this exists: the profile page used to write `profiles` straight from the browser client.
 * The only UPDATE policy on `profiles` is "Owner manages profiles" (get_user_role() = 'owner'),
 * so for every non-owner the update matched zero rows — and PostgREST reports that as SUCCESS,
 * not an error. The page then optimistically showed the new nickname, and a refresh brought the
 * old one back. Fixed by writing server-side with the service client, scoped to auth.uid().
 *
 * Only display_name and avatar_url are writable here. role / active / username / must_change_password
 * stay out of reach — this endpoint must never become a privilege-escalation path.
 */

const MAX_DISPLAY_NAME = 60;

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  if ('display_name' in body) {
    const raw = body.display_name;
    if (raw !== null && typeof raw !== 'string') {
      return NextResponse.json({ error: 'display_name must be a string or null' }, { status: 400 });
    }
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (trimmed.length > MAX_DISPLAY_NAME) {
      return NextResponse.json({ error: `display_name must be ${MAX_DISPLAY_NAME} characters or fewer` }, { status: 400 });
    }
    patch.display_name = trimmed || null;
  }

  if ('avatar_url' in body) {
    const raw = body.avatar_url;
    if (raw !== null && typeof raw !== 'string') {
      return NextResponse.json({ error: 'avatar_url must be a string or null' }, { status: 400 });
    }
    patch.avatar_url = typeof raw === 'string' ? raw.trim() || null : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select('id, username, display_name, avatar_url')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
