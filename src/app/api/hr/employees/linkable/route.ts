import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';

// GET /api/hr/employees/linkable?q= — existing accounts that can be attached to a new
// hr_employees record (not owner/customer, and not already an employee). Feeds the
// "link existing user" mode of the onboarding form, so a person who already uses the app
// keeps their login and all HR features stay keyed to the same profiles.id.
// Deactivated accounts ARE included (labelled client-side) — linking one re-activates it,
// covering the common case of a returning employee whose old login was disabled.
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();
  const service = createServiceClient();

  const [{ data: profiles, error: profErr }, { data: emps, error: empErr }] = await Promise.all([
    service
      .from('profiles')
      .select('id, username, display_name, role, active')
      .not('role', 'in', '(owner,customer)')
      .order('active', { ascending: false })
      .order('display_name', { ascending: true }),
    service.from('hr_employees').select('profile_id'),
  ]);
  if (profErr || empErr) {
    return NextResponse.json({ error: 'Failed to load linkable users' }, { status: 500 });
  }

  const taken = new Set((emps ?? []).map((e) => e.profile_id as string));
  const rows = (profiles ?? [])
    .filter((p) => !taken.has(p.id as string))
    .filter((p) =>
      q
        ? String(p.username ?? '').toLowerCase().includes(q) ||
          String(p.display_name ?? '').toLowerCase().includes(q)
        : true
    )
    .slice(0, 100);

  return NextResponse.json({ data: rows });
}
