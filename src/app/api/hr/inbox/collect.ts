import type { SupabaseClient } from '@supabase/supabase-js';
import type { InboxItem, InboxType } from './items';
import { punchIdsAwaitingRequests } from '@/lib/hr/attendance-review';

/**
 * Gather every item waiting on HR, across all request types, into InboxItem rows.
 *
 * One collector feeds both GET /api/hr/inbox (the list) and GET /api/hr/dashboard/badges (the
 * counts), so a number on the hub is always the length of a list HR can open — the two used to
 * be computed separately and resignations, paper slips and unsigned offboardings sat in no count
 * at all (คุณเมย์ 2026-09-17: "พนักงานยื่นลาออกมาแต่ไม่เด้งโนติ ต้องเข้าไปดูเอง").
 *
 * Scope follows resolveHrScope: company HR (`storeIds === null`) sees everything; a store-scoped
 * manager sees only their stores' employees, and only the swaps at stores whose roster they own.
 * Rows carry their own company where the table has one; otherwise the employee's company is
 * looked up once at the end, so the per-company breakdown never needs a join per source.
 */
export interface InboxScope {
  userId: string;
  /** null = company-wide HR */
  storeIds: string[] | null;
}

type SB = SupabaseClient;
type Row = Record<string, unknown>;

// Unreviewed punches accumulate per punch, not per request, so they are the one source that can
// run into the thousands. Newest first and capped: the badge is then "500+" in spirit, and the
// review page itself pages the rest.
const ATTENDANCE_REVIEW_CAP = 500;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Which employees a store-scoped manager may see — the same rule the badges used before. */
async function scopedUserIds(service: SB, storeIds: string[]): Promise<string[]> {
  const { data } = await service.from('user_stores').select('user_id').in('store_id', storeIds);
  return [...new Set((data ?? []).map((r) => r.user_id as string))];
}

/**
 * Day-off swaps are decided at the store (client decision 2026-07-20); company HR only
 * acknowledges approved ones, and decides itself only where no one else can. A scoped caller's
 * swaps are the pending ones at the stores they schedule. Mirrors the old countSwaps exactly.
 */
async function collectSwaps(service: SB, scope: InboxScope): Promise<InboxItem[]> {
  const cols = 'id, requester_id, store_id, status, created_at, requester_date';
  const toItem = (r: Row, note: string): InboxItem => ({
    id: r.id as string,
    type: 'swap',
    user_id: str(r.requester_id),
    store_id: str(r.store_id),
    company_id: null,
    submitted_at: r.created_at as string,
    date: str(r.requester_date),
    note,
  });

  if (scope.storeIds) {
    const { data: own } = await service
      .from('hr_manager_scopes')
      .select('store_id')
      .eq('user_id', scope.userId)
      .eq('can_schedule', true);
    const storeIds = [...new Set((own ?? []).map((s) => s.store_id as string))];
    if (storeIds.length === 0) return [];
    const { data } = await service
      .from('hr_dayoff_swaps')
      .select(cols)
      .eq('status', 'pending')
      .in('store_id', storeIds);
    return ((data ?? []) as Row[]).map((r) => toItem(r, 'decide'));
  }

  const [{ data: unacked }, { data: scopes }] = await Promise.all([
    service.from('hr_dayoff_swaps').select(cols).eq('status', 'approved').is('hr_acked_at', null),
    service.from('hr_manager_scopes').select('store_id').eq('can_schedule', true),
  ]);
  const covered = [...new Set((scopes ?? []).map((s) => s.store_id as string))];
  let uncovered = service.from('hr_dayoff_swaps').select(cols).eq('status', 'pending');
  if (covered.length) uncovered = uncovered.not('store_id', 'in', `(${covered.join(',')})`);
  const { data: pendingUncovered } = await uncovered;
  return [
    ...((unacked ?? []) as Row[]).map((r) => toItem(r, 'ack')),
    ...((pendingUncovered ?? []) as Row[]).map((r) => toItem(r, 'decide')),
  ];
}

/** Paper-slip requests hang off the payslip, so the employee and venue come from the slip's run. */
async function collectPaperSlips(service: SB, userIds: string[] | null): Promise<InboxItem[]> {
  const { data } = await service
    .from('hr_payslip_print_requests')
    .select('id, requested_at, payslip:hr_payslips(user_id, payrun:hr_payruns(store_id, period_year, period_month))')
    .eq('status', 'requested');
  const items: InboxItem[] = [];
  for (const r of (data ?? []) as Row[]) {
    const slip = r.payslip as { user_id?: string; payrun?: { store_id?: string | null; period_year?: number; period_month?: number } | null } | null;
    const userId = slip?.user_id ?? null;
    if (userIds && (!userId || !userIds.includes(userId))) continue;
    const run = slip?.payrun ?? null;
    items.push({
      id: r.id as string,
      type: 'paper_slip',
      user_id: userId,
      store_id: run?.store_id ?? null,
      company_id: null,
      submitted_at: r.requested_at as string,
      date: null,
      note: run?.period_year ? `${String(run.period_month).padStart(2, '0')}/${run.period_year}` : null,
    });
  }
  return items;
}

/**
 * A table-backed source: [type, table, waiting-status column + value, employee column, and how
 * the row maps onto the item]. Everything except swaps and paper slips fits this shape.
 */
interface Source {
  type: InboxType;
  table: string;
  col: string;
  val: string | string[];
  userCol: string;
  select: string;
  /** columns that must be NULL for the row to be waiting (e.g. not yet signed) */
  nullCols?: string[];
  order: string;
  limit?: number;
  /** ids waiting elsewhere in the inbox already — left out so one fact is counted once */
  excludeIds?: (service: SB, userIds: string[] | null) => Promise<string[]>;
  map: (r: Row) => Omit<InboxItem, 'id' | 'type' | 'user_id'>;
}

const SOURCES: Source[] = [
  {
    type: 'leave',
    table: 'hr_leaves',
    col: 'status',
    val: 'pending',
    userCol: 'user_id',
    select: 'id, user_id, store_id, company_id, from_date, created_at, leave_type:hr_leave_types(name_th)',
    order: 'created_at',
    map: (r) => ({
      store_id: str(r.store_id),
      company_id: str(r.company_id),
      submitted_at: r.created_at as string,
      date: str(r.from_date),
      note: str((r.leave_type as { name_th?: string } | null)?.name_th),
    }),
  },
  {
    type: 'resignation',
    table: 'hr_resignation_requests',
    col: 'status',
    val: 'pending',
    userCol: 'user_id',
    select: 'id, user_id, store_id, company_id, notice_date, created_at',
    order: 'created_at',
    map: (r) => ({
      store_id: str(r.store_id),
      company_id: str(r.company_id),
      submitted_at: r.created_at as string,
      date: str(r.notice_date),
      note: null,
    }),
  },
  {
    // Nothing in the app ever writes 'pending_signoff' today, so "awaiting the employee's
    // acknowledgement" is any open offboarding the employee has not signed yet.
    type: 'offboarding_ack',
    table: 'hr_offboarding',
    col: 'status',
    val: ['draft', 'pending_signoff'],
    userCol: 'user_id',
    select: 'id, user_id, store_id, company_id, kind, last_working_date, created_at',
    nullCols: ['employee_signed_at'],
    order: 'created_at',
    map: (r) => ({
      store_id: str(r.store_id),
      company_id: str(r.company_id),
      submitted_at: r.created_at as string,
      date: str(r.last_working_date),
      note: str(r.kind),
    }),
  },
  {
    type: 'attendance_request',
    table: 'hr_attendance_requests',
    col: 'status',
    val: 'pending',
    userCol: 'user_id',
    select: 'id, user_id, store_id, business_date, kind, created_at',
    order: 'created_at',
    map: (r) => ({
      store_id: str(r.store_id),
      company_id: null,
      submitted_at: r.created_at as string,
      date: str(r.business_date),
      note: str(r.kind),
    }),
  },
  {
    type: 'ot',
    table: 'hr_ot_requests',
    col: 'status',
    val: 'pending',
    userCol: 'user_id',
    select: 'id, user_id, store_id, work_date, requested_ot_min, created_at',
    order: 'created_at',
    map: (r) => ({
      store_id: str(r.store_id),
      company_id: null,
      submitted_at: r.created_at as string,
      date: str(r.work_date),
      note: typeof r.requested_ot_min === 'number' ? String(r.requested_ot_min) : null,
    }),
  },
  {
    type: 'profile_change',
    table: 'hr_profile_change_requests',
    col: 'status',
    val: 'pending',
    userCol: 'user_id',
    select: 'id, user_id, field_key, created_at',
    order: 'created_at',
    map: (r) => ({
      store_id: null,
      company_id: null,
      submitted_at: r.created_at as string,
      date: null,
      note: str(r.field_key),
    }),
  },
  {
    // Amounts stay out on purpose: pay figures are gated per viewer (pay-visibility.ts) and the
    // inbox is not a pay surface — the claims page applies that gate when HR opens the row.
    type: 'claim',
    table: 'hr_claims',
    col: 'status',
    val: 'pending',
    userCol: 'user_id',
    select: 'id, user_id, store_id, company_id, claim_type, claim_date, created_at',
    order: 'created_at',
    map: (r) => ({
      store_id: str(r.store_id),
      company_id: str(r.company_id),
      submitted_at: r.created_at as string,
      date: str(r.claim_date),
      note: str(r.claim_type),
    }),
  },
  {
    type: 'document',
    table: 'hr_document_requests',
    col: 'status',
    val: 'requested',
    userCol: 'profile_id',
    select: 'id, profile_id, doc_type, created_at',
    order: 'created_at',
    map: (r) => ({
      store_id: null,
      company_id: null,
      submitted_at: r.created_at as string,
      date: null,
      note: str(r.doc_type),
    }),
  },
  {
    type: 'identity_claim',
    table: 'hr_pending_identities',
    col: 'status',
    val: 'claimed',
    userCol: 'claimed_by',
    select: 'id, claimed_by, store_id, company_id, full_name_th, claimed_at',
    order: 'claimed_at',
    map: (r) => ({
      store_id: str(r.store_id),
      company_id: str(r.company_id),
      submitted_at: (r.claimed_at as string | null) ?? new Date(0).toISOString(),
      date: null,
      note: str(r.full_name_th),
    }),
  },
  {
    type: 'attendance_review',
    table: 'hr_attendance',
    col: 'review_status',
    val: 'pending',
    userCol: 'user_id',
    select: 'id, user_id, store_id, business_date, ts, type',
    order: 'ts',
    limit: ATTENDANCE_REVIEW_CAP,
    // A forgotten check-out with its correction request already filed is that request's item.
    excludeIds: punchIdsAwaitingRequests,
    map: (r) => ({
      store_id: str(r.store_id),
      company_id: null,
      submitted_at: r.ts as string,
      date: str(r.business_date),
      note: str(r.type),
    }),
  },
];

async function collectSource(service: SB, src: Source, userIds: string[] | null): Promise<InboxItem[]> {
  let q = service.from(src.table).select(src.select);
  q = Array.isArray(src.val) ? q.in(src.col, src.val) : q.eq(src.col, src.val);
  if (userIds) q = q.in(src.userCol, userIds);
  for (const col of src.nullCols ?? []) q = q.is(col, null);
  if (src.excludeIds) {
    try {
      const skip = await src.excludeIds(service, userIds);
      if (skip.length) q = q.not('id', 'in', `(${skip.join(',')})`);
    } catch (e) {
      // Fall back to the unfiltered list (some items counted twice) rather than dropping the source.
      console.error(`[hr-inbox] ${src.table} exclusion failed:`, e instanceof Error ? e.message : e);
    }
  }
  q = q.order(src.order, { ascending: false });
  if (src.limit) q = q.limit(src.limit);
  const { data, error } = await q;
  if (error) {
    // One broken source must not blank the whole inbox — the others still show. Logged so a
    // renamed column surfaces in the server log rather than as a silently shorter list.
    console.error(`[hr-inbox] ${src.table} failed:`, error.message);
    return [];
  }
  // The select string is built per source, so the client cannot infer the row shape.
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id as string,
    type: src.type,
    user_id: str(r[src.userCol]),
    ...src.map(r),
  }));
}

/** Fill company_id from hr_employees for rows whose table has no company column. */
async function attachCompanies(service: SB, items: InboxItem[]): Promise<InboxItem[]> {
  const missing = [...new Set(items.filter((it) => !it.company_id && it.user_id).map((it) => it.user_id as string))];
  if (missing.length === 0) return items;
  const { data } = await service.from('hr_employees').select('profile_id, company_id').in('profile_id', missing);
  // One profile can hold several employee rows (rehire/move) — first company wins, as in
  // buildQueueMetaMap; enough for a queue label and never used to gate anything.
  const companyByUser = new Map<string, string>();
  for (const e of (data ?? []) as { profile_id: string; company_id: string | null }[]) {
    if (e.company_id && !companyByUser.has(e.profile_id)) companyByUser.set(e.profile_id, e.company_id);
  }
  return items.map((it) =>
    it.company_id || !it.user_id ? it : { ...it, company_id: companyByUser.get(it.user_id) ?? null }
  );
}

export async function collectInboxItems(service: SB, scope: InboxScope): Promise<InboxItem[]> {
  const userIds = scope.storeIds ? await scopedUserIds(service, scope.storeIds) : null;
  // A scoped manager with no employees at all has nothing to see — and an empty `in()` list would
  // otherwise match nothing anyway, so short-circuit before a dozen queries.
  if (userIds && userIds.length === 0) return collectSwaps(service, scope);

  const [perSource, swaps, paper] = await Promise.all([
    Promise.all(SOURCES.map((s) => collectSource(service, s, userIds))),
    collectSwaps(service, scope),
    collectPaperSlips(service, userIds),
  ]);
  return attachCompanies(service, [...perSource.flat(), ...swaps, ...paper]);
}
