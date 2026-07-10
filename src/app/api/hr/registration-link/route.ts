import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

// HR self-registration link management (owner ask 2026-07-10). A reusable link many new hires can
// open to self-onboard (→ role 'not_assign' + an hr_employees record). HR-gated.
const TABLE = 'hr_registration_links';
const TTL_DAYS = 90;

function newToken(): string {
  return randomBytes(24).toString('base64url');
}
function linkUrl(origin: string, token: string): string {
  return `${origin}/register/${token}`;
}

// GET — the current active link (or null). Never re-mints; POST does that.
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data: link } = await service
    .from(TABLE)
    .select('token, company_id, expires_at, used_count, created_at')
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!link) return NextResponse.json({ data: null });
  return NextResponse.json({
    data: {
      url: linkUrl(request.nextUrl.origin, link.token as string),
      company_id: link.company_id,
      expires_at: link.expires_at,
      used_count: link.used_count,
      created_at: link.created_at,
    },
  });
}

// POST — mint a new reusable link, revoking any prior active one (exactly one link works at a time).
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const companyId = typeof body.company_id === 'string' && body.company_id ? body.company_id : null;

  const service = createServiceClient();
  await service.from(TABLE).update({ revoked_at: new Date().toISOString() }).is('revoked_at', null);

  const token = newToken();
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000).toISOString();
  const { data, error } = await service
    .from(TABLE)
    .insert({ token, company_id: companyId, created_by: auth.userId, expires_at: expiresAt })
    .select('token, expires_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'create', table: TABLE, recordId: token,
    before: null, after: { company_id: companyId, expires_at: expiresAt }, reason: 'HR registration link issued',
  });

  return NextResponse.json(
    { data: { url: linkUrl(request.nextUrl.origin, data.token as string), expires_at: data.expires_at } },
    { status: 201 }
  );
}

// DELETE — revoke the active link(s).
export async function DELETE() {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { error } = await service.from(TABLE).update({ revoked_at: new Date().toISOString() }).is('revoked_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: TABLE, recordId: 'active',
    before: null, after: { revoked: true }, reason: 'HR registration link revoked',
  });
  return NextResponse.json({ data: { revoked: true } });
}
