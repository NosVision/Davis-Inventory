import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';

// GET /api/hr/document-requests — HR queue for personal-document requests (⑥). Open first,
// then recently decided, with the requester's name resolved.
export async function GET() {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data: rows, error } = await service
    .from('hr_document_requests')
    .select('id, profile_id, doc_type, year, note, status, fulfillment, decided_at, created_at')
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });

  const list = rows ?? [];
  const profIds = [...new Set(list.map((r) => r.profile_id as string))];
  const [{ data: profs }, { data: emps }] = await Promise.all([
    service.from('profiles').select('id, username, display_name').in('id', profIds),
    service.from('hr_employees').select('profile_id, full_name').in('profile_id', profIds),
  ]);
  const nameById = new Map<string, string>();
  const fullByProfile = new Map((emps ?? []).map((e) => [e.profile_id as string, e.full_name as string | null]));
  for (const p of profs ?? []) {
    nameById.set(p.id as string, fullByProfile.get(p.id as string) || (p.display_name as string) || (p.username as string) || '—');
  }

  return NextResponse.json({
    data: list.map((r) => ({ ...r, name: nameById.get(r.profile_id as string) ?? '—' })),
  });
}
