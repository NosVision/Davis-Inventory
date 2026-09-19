import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope } from '@/lib/hr/route-auth';
import { buildEmployeeNameMap } from '@/lib/hr/employee-name-map';
import { collectInboxItems } from './collect';
import {
  countByCompany,
  countByType,
  filterInboxItems,
  isInboxType,
  sortInboxItems,
  INBOX_HREF,
  type InboxItem,
} from './items';

/**
 * GET /api/hr/inbox?company_id=&type= — every item waiting on HR, across all request types and
 * all companies, as one list (คุณเมย์ 2026-09-08: "คำขอต้องเข้าไปไล่หาทีละบริษัท").
 *
 * Scope is resolveHrScope, exactly as the per-queue pages. The response carries no pay figures —
 * a claim shows its type and date, a paper-slip request its period — so the confidential-pay
 * gate (pay-visibility.ts) has nothing to hide here; it applies when HR opens the row on its own
 * page. `companies` / `types` are counted over the UNFILTERED scope so the filter controls can
 * show how many rows each choice holds.
 */
export interface InboxRow extends InboxItem {
  employee_name: string | null;
  employee_nickname: string | null;
  /** false when the profile has no hr_employees row yet (a bare login) */
  employee_linked: boolean;
  company_name: string | null;
  store_name: string | null;
  href: string;
}

export async function GET(request: NextRequest) {
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const sp = request.nextUrl.searchParams;
  const companyId = sp.get('company_id') ?? '';
  const typeParam = sp.get('type');
  const type = isInboxType(typeParam) ? typeParam : null;

  const service = createServiceClient();
  const all = await collectInboxItems(service, { userId: scope.userId, storeIds: scope.storeIds });

  const userIds = all.map((it) => it.user_id).filter((id): id is string => !!id);
  const storeIds = [...new Set(all.map((it) => it.store_id).filter((id): id is string => !!id))];
  const companyIds = [...new Set(all.map((it) => it.company_id).filter((id): id is string => !!id))];

  const [names, storesRes, companiesRes] = await Promise.all([
    buildEmployeeNameMap(service, userIds),
    storeIds.length
      ? service.from('stores').select('id, store_name').in('id', storeIds)
      : Promise.resolve({ data: [] as { id: string; store_name: string | null }[] }),
    companyIds.length
      ? service.from('hr_companies').select('id, name').in('id', companyIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const storeName = new Map(
    ((storesRes.data ?? []) as { id: string; store_name: string | null }[]).map((s) => [s.id, s.store_name ?? ''])
  );
  const companyName = new Map(((companiesRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

  const visible = sortInboxItems(filterInboxItems(all, { companyId, type }));
  const rows: InboxRow[] = visible.map((it) => {
    const person = it.user_id ? names.get(it.user_id) : undefined;
    return {
      ...it,
      employee_name: person?.name ?? null,
      employee_nickname: person?.nickname ?? null,
      employee_linked: person?.linked ?? false,
      company_name: it.company_id ? (companyName.get(it.company_id) ?? null) : null,
      store_name: it.store_id ? (storeName.get(it.store_id) ?? null) : null,
      href: INBOX_HREF[it.type],
    };
  });

  return NextResponse.json({
    data: {
      items: rows,
      total: all.length,
      companies: countByCompany(all, companyName),
      types: countByType(all),
    },
  });
}
