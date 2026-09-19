/**
 * The HR inbox's pure half: what an inbox row is, how rows are ordered, filtered and counted.
 *
 * Every request an employee can file lands in a different table with a different "waiting" status,
 * so HR had to open a dozen queues — and, since every queue is store-scoped, open each one company
 * by company (คุณเมย์ 2026-09-08: "คำขอต้องเข้าไปไล่หาทีละบริษัท"). This module flattens them
 * into one row shape so /hr/inbox and the hub badges count the same things the same way.
 *
 * No imports on purpose: scripts/test-inbox.cjs loads this file standalone.
 */

export const INBOX_TYPES = [
  'leave',
  'swap',
  'resignation',
  'offboarding_ack',
  'attendance_request',
  'ot',
  'profile_change',
  'claim',
  'document',
  'paper_slip',
  'identity_claim',
  'attendance_review',
] as const;

export type InboxType = (typeof INBOX_TYPES)[number];

export function isInboxType(v: unknown): v is InboxType {
  return typeof v === 'string' && (INBOX_TYPES as readonly string[]).includes(v);
}

export interface InboxItem {
  /** the source row's id — what the decide page will act on */
  id: string;
  type: InboxType;
  /** the employee the item is about (profile id); null only for an orphaned reference */
  user_id: string | null;
  store_id: string | null;
  /** the row's own company when it carries one, else the employee's (hr_employees.company_id) */
  company_id: string | null;
  /** when the employee filed it — the inbox sorts on this */
  submitted_at: string;
  /** the date the request is about (work date, leave start, notice date…), if any */
  date: string | null;
  /** a type-specific code the page turns into words (leave type, punch kind, field key…) */
  note: string | null;
}

/**
 * Where HR decides each kind of item. Only /hr/attendance and /hr/employees read a query string
 * today, so the rest land on the queue page itself (all stores, pending first).
 */
export const INBOX_HREF: Record<InboxType, string> = {
  leave: '/hr/leaves',
  swap: '/hr/swaps',
  resignation: '/hr/offboarding',
  offboarding_ack: '/hr/offboarding',
  attendance_request: '/hr/requests',
  ot: '/hr/requests',
  profile_change: '/hr/profile-requests',
  claim: '/hr/claims',
  document: '/hr/document-requests',
  paper_slip: '/hr/payroll',
  identity_claim: '/hr/employees?tab=accounts&view=claims',
  attendance_review: '/hr/attendance?review=pending',
};

/** Newest first; ties broken by type then id so two polls never reorder equal rows. */
export function sortInboxItems<T extends InboxItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const dt = Date.parse(b.submitted_at) - Date.parse(a.submitted_at);
    if (dt !== 0 && !Number.isNaN(dt)) return dt;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface InboxFilter {
  /** a company id, 'none' for rows with no company, or '' / null for every company */
  companyId?: string | null;
  type?: InboxType | null;
}

export function filterInboxItems<T extends InboxItem>(items: readonly T[], filter: InboxFilter): T[] {
  const company = filter.companyId ?? '';
  const type = filter.type ?? null;
  return items.filter((it) => {
    if (type && it.type !== type) return false;
    if (company === 'none') return it.company_id === null;
    if (company) return it.company_id === company;
    return true;
  });
}

export interface CompanyCount {
  /** null = rows whose employee has no company on file */
  company_id: string | null;
  name: string | null;
  count: number;
}

/**
 * Pending items per company, busiest first, so HR can see at a glance which company's queue is
 * deepest instead of visiting each. A null bucket appears only when something sits in it.
 */
export function countByCompany(
  items: readonly InboxItem[],
  nameById: ReadonlyMap<string, string>
): CompanyCount[] {
  const counts = new Map<string | null, number>();
  for (const it of items) counts.set(it.company_id, (counts.get(it.company_id) ?? 0) + 1);
  return [...counts.entries()]
    .map(([company_id, count]) => ({
      company_id,
      name: company_id ? (nameById.get(company_id) ?? null) : null,
      count,
    }))
    .sort((a, b) => b.count - a.count || (a.name ?? '￿').localeCompare(b.name ?? '￿'));
}

export function countByType(items: readonly InboxItem[]): Record<InboxType, number> {
  const out = Object.fromEntries(INBOX_TYPES.map((t) => [t, 0])) as Record<InboxType, number>;
  for (const it of items) out[it.type] += 1;
  return out;
}
