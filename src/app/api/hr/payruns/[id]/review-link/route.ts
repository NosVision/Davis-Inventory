import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { newReviewToken, hashReviewToken, REVIEW_LINK_TTL_DAYS, normalizePasscode, DEFAULT_REVIEW_PASSCODE } from '@/lib/hr/review-link';

async function authForPayrun(service: ReturnType<typeof createServiceClient>, payrunId: string) {
  const { data: payrun } = await service.from('hr_payruns').select('id, store_id, status').eq('id', payrunId).maybeSingle();
  if (!payrun) return { payrun: null, auth: null };
  const auth = await requireHrManagerForStore((payrun.store_id as string | null) ?? null);
  return { payrun, auth };
}

// POST /api/hr/payruns/[id]/review-link — mint the accountant link for this payrun. The raw
// token appears ONLY in this response (DB stores its hash); any previous active link for the
// payrun is revoked so exactly one link works at a time.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();
  const { payrun, auth } = await authForPayrun(service, id);
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  if (!auth || !auth.ok) return NextResponse.json({ error: auth?.error ?? 'Forbidden' }, { status: auth?.status ?? 403 });

  await service
    .from('hr_payrun_review_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('payrun_id', id)
    .is('revoked_at', null);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // passcode: caller may set one; blank → default '1234'; malformed → 400
  let passcode = DEFAULT_REVIEW_PASSCODE;
  if (body.passcode !== undefined && body.passcode !== null && body.passcode !== '') {
    const norm = normalizePasscode(body.passcode);
    if (!norm) return NextResponse.json({ error: 'passcode must be 4–12 letters/digits' }, { status: 400 });
    passcode = norm;
  }

  const token = newReviewToken();
  const expiresAt = new Date(Date.now() + REVIEW_LINK_TTL_DAYS * 86_400_000).toISOString();
  const { error } = await service.from('hr_payrun_review_links').insert({
    payrun_id: id,
    token_hash: hashReviewToken(token),
    created_by: auth.userId,
    expires_at: expiresAt,
    passcode,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: 'hr_payrun_review_links',
    recordId: id,
    before: null,
    after: { expires_at: expiresAt },
    reason: 'Accountant review link issued',
  });

  const url = `${request.nextUrl.origin}/review/${token}`;
  return NextResponse.json({ data: { url, expires_at: expiresAt, passcode } }, { status: 201 });
}

// GET — status of the current active link (never the token itself; that is unrecoverable).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();
  const { payrun, auth } = await authForPayrun(service, id);
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  if (!auth || !auth.ok) return NextResponse.json({ error: auth?.error ?? 'Forbidden' }, { status: auth?.status ?? 403 });

  const { data: link } = await service
    .from('hr_payrun_review_links')
    .select('created_at, expires_at, accessed_at, saved_at, confirmed_at, passcode')
    .eq('payrun_id', id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ data: link ?? null });
}

// DELETE — revoke the active link (e.g. sent to the wrong chat).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();
  const { payrun, auth } = await authForPayrun(service, id);
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  if (!auth || !auth.ok) return NextResponse.json({ error: auth?.error ?? 'Forbidden' }, { status: auth?.status ?? 403 });

  const { error } = await service
    .from('hr_payrun_review_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('payrun_id', id)
    .is('revoked_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: 'hr_payrun_review_links',
    recordId: id,
    before: null,
    after: { revoked: true },
    reason: 'Accountant review link revoked',
  });
  return NextResponse.json({ data: { revoked: true } });
}
