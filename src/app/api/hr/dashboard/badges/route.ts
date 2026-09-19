import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope } from '@/lib/hr/route-auth';
import { collectInboxItems } from '@/app/api/hr/inbox/collect';
import { countByCompany, countByType, type CompanyCount } from '@/app/api/hr/inbox/items';

/**
 * GET /api/hr/dashboard/badges — per-area "needs HR action" counts that drive the badge numbers
 * on the HR hub tiles + the sidebar menu (owner ask 2026-07-08). Scoped: company-HR counts
 * everyone; a store manager counts only their stores' employees.
 *
 * Counts come from the same collector as /hr/inbox, so every number here is the length of a list
 * HR can open. Before 2026-09-19 this route kept its own head-count list, and whatever was not on
 * it — resignations, paper slips, offboardings waiting for a signature — never showed anywhere
 * (คุณเมย์ 2026-09-17). `inbox` is the grand total the sidebar badge shows; `by_company` is what
 * lets HR see which company's queue is deepest without visiting each (คุณเมย์ 2026-09-08).
 */
export interface HrBadges {
  leave: number;
  attendance: number;
  /** time-correction + OT requests — the hub's "requests" tile covers both */
  requests: number;
  swaps: number;
  claims: number;
  profileRequests: number;
  documentRequests: number;
  identityClaims: number;
  resignations: number;
  paperSlips: number;
  offboardingAck: number;
  /** everything above, once */
  inbox: number;
  /** kept for older clients — same number as `inbox` */
  total: number;
  by_company: CompanyCount[];
}

export async function GET() {
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const service = createServiceClient();
  const items = await collectInboxItems(service, { userId: scope.userId, storeIds: scope.storeIds });
  const byType = countByType(items);

  const companyIds = [...new Set(items.map((it) => it.company_id).filter((id): id is string => !!id))];
  const { data: companies } = companyIds.length
    ? await service.from('hr_companies').select('id, name').in('id', companyIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map(((companies ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

  const data: HrBadges = {
    leave: byType.leave,
    attendance: byType.attendance_review,
    requests: byType.attendance_request + byType.ot,
    swaps: byType.swap,
    claims: byType.claim,
    profileRequests: byType.profile_change,
    documentRequests: byType.document,
    identityClaims: byType.identity_claim,
    resignations: byType.resignation,
    paperSlips: byType.paper_slip,
    offboardingAck: byType.offboarding_ack,
    inbox: items.length,
    total: items.length,
    by_company: countByCompany(items, nameById),
  };

  return NextResponse.json({ data });
}
