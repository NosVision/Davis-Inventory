import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { cycleDates, isCycleClosed } from '@/lib/hr/pay-cycle';
import { payHiddenProfileIds } from '@/lib/hr/pay-visibility';
import { loadUnauthorizedAbsentDays } from '@/lib/hr/absence-summary';
import { businessDateBangkok } from '@/lib/utils/date';

/**
 * GET /api/hr/payroll/coverage?year=&month= — did this period actually pay everyone it should?
 *
 * Payrun generation is manual and per (company × payroll group), so a period is only complete once
 * someone has pressed generate for every slice — and pressed it AGAIN for any slice whose staff
 * changed since. Nothing in the app said whether that had happened: HR had to open each run and
 * count. In the July 2026 period four of five companies were short, one of them by 34 people,
 * because runs were generated early in testing and never rebuilt (owner report 2026-08-17).
 *
 * Read-only and money-free: this route returns names and counts, never an amount. That is what
 * lets it list confidential-pay staff — the module's rule is "hide the NUMBERS, not the PERSON",
 * and a coverage gap that silently skipped those people would defeat the panel's only purpose.
 */

/** Expected-headcount rule, kept identical to the payrun POST's employee selection. */
interface EligibleRow {
  profile_id: string;
  company_id: string | null;
  payroll_group_id: string | null;
  full_name: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  pay_type: string | null;
}

export type BucketState =
  /** Everyone expected has a payslip. */
  | 'ok'
  /** The period has not closed yet — nothing is late. */
  | 'not_due'
  /** Period closed, no payrun exists for this slice at all. */
  | 'not_generated'
  /** A payrun exists but does not cover everyone — it needs regenerating. */
  | 'incomplete';

export async function GET(request: NextRequest) {
  // Company-wide by nature: it reports across every company, so it is full-HR only. A
  // store-scoped manager has no slice of this to see.
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = request.nextUrl.searchParams;
  const year = Number(sp.get('year'));
  const month = Number(sp.get('month'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'invalid year' }, { status: 400 });
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'invalid month' }, { status: 400 });
  }

  const cycle = cycleDates(year, month);
  const closed = isCycleClosed(cycle);
  const service = createServiceClient();

  const [empRes, payrunRes, companyRes, groupRes] = await Promise.all([
    // Same filter as payrun generation: employed at some point inside the cycle.
    service
      .from('hr_employees')
      .select('profile_id, company_id, payroll_group_id, full_name, status, start_date, end_date, pay_type')
      .or(`status.in.(active,probation),end_date.gte.${cycle.start}`),
    service
      .from('hr_payruns')
      .select('id, company_id, payroll_group_id, store_id, status')
      .eq('period_year', year)
      .eq('period_month', month),
    service.from('hr_companies').select('id, name'),
    service.from('hr_payroll_groups').select('id, name'),
  ]);
  if (empRes.error || payrunRes.error || companyRes.error || groupRes.error) {
    return NextResponse.json({ error: 'Failed to load coverage' }, { status: 500 });
  }

  const empRows = ((empRes.data ?? []) as EligibleRow[]).filter((e) => !!e.profile_id);

  // Keyed on the employee ids we actually need, never the whole profiles table: PostgREST caps a
  // select at 1000 rows silently, and profiles grows with every account ever created — a truncated
  // read here would drop people from the expected headcount, which is the one number this route exists to get right.
  const profileIds = [...new Set(empRows.map((e) => e.profile_id))];
  let profiles: { id: string; display_name: string | null; username: string | null; is_system: boolean | null }[] = [];
  if (profileIds.length > 0) {
    const { data: profData, error: profErr } = await service
      .from('profiles')
      .select('id, display_name, username, is_system')
      .in('id', profileIds);
    if (profErr) return NextResponse.json({ error: 'Failed to load coverage' }, { status: 500 });
    profiles = (profData ?? []) as typeof profiles;
  }
  const profById = new Map(profiles.map((p) => [p.id, p]));

  const eligible = empRows.filter((e) => {
    // Machines are not payees — same exclusion the payrun POST applies.
    if (profById.get(e.profile_id)?.is_system) return false;
    const startsInTime = !e.start_date || e.start_date <= cycle.end;
    const endsInTime = !e.end_date || e.end_date >= cycle.start;
    return startsInTime && endsInTime;
  });

  const payruns = (payrunRes.data ?? []) as {
    id: string;
    company_id: string;
    payroll_group_id: string | null;
    store_id: string | null;
    status: string;
  }[];

  // Who already has a slip anywhere in this period. Keyed on the person, not the run: a
  // store-scoped run pays them just as a company-wide one does, and either way they are covered.
  const runIds = payruns.map((p) => p.id);
  let paidUserIds = new Set<string>();
  if (runIds.length > 0) {
    const { data: slips, error: slipErr } = await service
      .from('hr_payslips')
      .select('user_id')
      .in('payrun_id', runIds);
    if (slipErr) return NextResponse.json({ error: 'Failed to load payslips' }, { status: 500 });
    paidUserIds = new Set((slips ?? []).map((s) => s.user_id as string));
  }

  const companyName = new Map(
    ((companyRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
  );
  const groupName = new Map(
    ((groupRes.data ?? []) as { id: string; name: string }[]).map((g) => [g.id, g.name])
  );

  // Which venues a person works, so a missing row can be chased to a place rather than a name.
  const missingCandidates = eligible.filter((e) => !paidUserIds.has(e.profile_id)).map((e) => e.profile_id);
  const storesByUser = new Map<string, string[]>();
  if (missingCandidates.length > 0) {
    const { data: links } = await service
      .from('user_stores')
      .select('user_id, store:stores(store_code)')
      .in('user_id', missingCandidates);
    for (const l of (links ?? []) as unknown as { user_id: string; store: { store_code: string | null } | null }[]) {
      const code = l.store?.store_code;
      if (!code) continue;
      storesByUser.set(l.user_id, [...(storesByUser.get(l.user_id) ?? []), code]);
    }
  }

  // Who this caller may not see the pay of (§00195: the ลับ flag, or a payroll group owned by
  // someone else). A slice holding any of them cannot be generated by this caller — the payrun POST
  // refuses it — so the card says so up front instead of letting the button 403 on click.
  const hiddenFromCaller = await payHiddenProfileIds(service, auth.userId);

  // Bucket by the pair that decides which run someone lands in.
  const bucketKey = (companyId: string | null, groupId: string | null) => `${companyId ?? ''}|${groupId ?? ''}`;
  const buckets = new Map<string, { company_id: string | null; payroll_group_id: string | null; rows: EligibleRow[] }>();
  for (const e of eligible) {
    const k = bucketKey(e.company_id, e.payroll_group_id);
    const b = buckets.get(k) ?? { company_id: e.company_id, payroll_group_id: e.payroll_group_id, rows: [] };
    b.rows.push(e);
    buckets.set(k, b);
  }

  // Heavy-absence check (owner report 2026-08-17..2026-08-26: ten back-office staff who never clock
  // in were marked absent ~20 days each and a draft slip silently docked two thirds of a salary).
  // Computed at the SAME grain the payrun generates — per (company, payroll group) slice, over the
  // SAME cycle dates, with the SAME closedThrough guard — because a warning that disagrees with what
  // the payslip actually docks is worse than no warning. See absence-summary.ts for why this
  // duplicates (rather than imports) the payrun POST's day-count logic, and for the row-cap reason
  // this is batched per SLICE instead of one whole-company query.
  const HEAVY_ABSENCE_THRESHOLD_DAYS = 5;
  const closedThrough = businessDateBangkok();
  const bucketList = [...buckets.values()];
  // Best-effort: this whole route's job is to say whether payroll paid everyone it should, and that
  // must still work even if the (newer, additive) absence check hits a snag — an empty heavy_absence
  // list degrades to "nothing to warn about", never to a 500 that hides real missing-payslip data.
  let absenceByBucket: Map<string, number>[];
  try {
    absenceByBucket = await Promise.all(
      bucketList.map((b) =>
        loadUnauthorizedAbsentDays(
          service,
          b.rows.map((e) => ({ profile_id: e.profile_id, start_date: e.start_date, end_date: e.end_date })),
          cycle.start,
          cycle.end,
          closedThrough
        )
      )
    );
  } catch {
    absenceByBucket = bucketList.map(() => new Map<string, number>());
  }
  const absenceByKey = new Map(
    bucketList.map((b, i) => [bucketKey(b.company_id, b.payroll_group_id), absenceByBucket[i]])
  );

  const data = [...buckets.values()]
    .map((b) => {
      const absenceCounts = absenceByKey.get(bucketKey(b.company_id, b.payroll_group_id)) ?? new Map<string, number>();
      const heavyAbsence = b.rows
        .filter((e) => (absenceCounts.get(e.profile_id) ?? 0) >= HEAVY_ABSENCE_THRESHOLD_DAYS)
        .map((e) => {
          const p = profById.get(e.profile_id);
          return {
            user_id: e.profile_id,
            name: e.full_name?.trim() || p?.display_name || p?.username || '—',
            absent_days: absenceCounts.get(e.profile_id) ?? 0,
          };
        })
        // Worst first — this list gets truncated to 4 on the card, so severity should lead.
        .sort((a, c) => c.absent_days - a.absent_days || a.name.localeCompare(c.name, 'th'));
      const missing = b.rows.filter((e) => !paidUserIds.has(e.profile_id));
      // Mid-period hire/leave proration reads hr_employees.start_date. With none, the engine takes
      // the person as employed for the WHOLE cycle and pays a full month — no error, no line on the
      // slip, nothing to notice. 23 of 130 staff had no start date on 26/08/2026, including every
      // one of the 16 on probation: the people most likely to have joined mid-cycle.
      // Only full_monthly is prorated, so a part-timer without a start date is not at risk here.
      const noStartDate = b.rows.filter((e) => !e.start_date && e.pay_type === 'full_monthly');
      const run =
        payruns.find(
          (p) => p.company_id === b.company_id && (p.payroll_group_id ?? null) === b.payroll_group_id
        ) ?? null;

      let state: BucketState;
      if (missing.length === 0) state = 'ok';
      else if (!closed) state = 'not_due';
      else if (!run) state = 'not_generated';
      else state = 'incomplete';

      return {
        company_id: b.company_id,
        company_name: b.company_id ? companyName.get(b.company_id) ?? null : null,
        payroll_group_id: b.payroll_group_id,
        payroll_group_name: b.payroll_group_id ? groupName.get(b.payroll_group_id) ?? null : null,
        expected: b.rows.length,
        with_slip: b.rows.length - missing.length,
        state,
        can_manage: !b.rows.some((e) => hiddenFromCaller.has(e.profile_id)),
        payrun: run ? { id: run.id, status: run.status } : null,
        // NOT filtered by hiddenFromCaller — same rule as `missing`/`no_start_date` above: this
        // route is money-free (a day count, never an amount), and the module's rule is "hide the
        // NUMBERS, not the PERSON" (see the file header). Hiding a hidden-pay person from the one
        // list that would catch their draft slip being wrong is exactly the silence this exists to end.
        heavy_absence: heavyAbsence,
        no_start_date: noStartDate
          .map((e) => {
            const p = profById.get(e.profile_id);
            return {
              user_id: e.profile_id,
              name: e.full_name?.trim() || p?.display_name || p?.username || '—',
              status: e.status,
            };
          })
          .sort((a, b2) => a.name.localeCompare(b2.name, 'th')),
        missing: missing
          .map((e) => {
            const p = profById.get(e.profile_id);
            return {
              user_id: e.profile_id,
              name: e.full_name?.trim() || p?.display_name || p?.username || '—',
              stores: storesByUser.get(e.profile_id) ?? [],
              // A leaver mid-period is expected but easy to misread as an error — label them.
              end_date: e.status === 'resigned' || e.status === 'terminated' ? e.end_date : null,
            };
          })
          .sort((a, b2) => a.name.localeCompare(b2.name, 'th')),
      };
    })
    .sort((a, b) => (a.company_name ?? '').localeCompare(b.company_name ?? '', 'th'));

  // A run whose slice has no eligible employee left produces no bucket above — and the payroll page
  // now reaches every run THROUGH these buckets, so without this such a run would be unreachable
  // (its slips still exist and still need reading). Appended with expected 0 rather than hidden.
  for (const run of payruns) {
    const known = data.some(
      (b) => b.company_id === run.company_id && b.payroll_group_id === (run.payroll_group_id ?? null)
    );
    if (known) continue;
    data.push({
      company_id: run.company_id,
      company_name: companyName.get(run.company_id) ?? null,
      payroll_group_id: run.payroll_group_id ?? null,
      payroll_group_name: run.payroll_group_id ? groupName.get(run.payroll_group_id) ?? null : null,
      expected: 0,
      with_slip: 0,
      state: 'ok',
      // No eligible members left to test, so nothing is hidden by definition.
      can_manage: true,
      payrun: { id: run.id, status: run.status },
      heavy_absence: [],
      no_start_date: [],
      missing: [],
    });
  }

  const totals = data.reduce(
    (acc, b) => ({
      expected: acc.expected + b.expected,
      with_slip: acc.with_slip + b.with_slip,
      missing: acc.missing + b.missing.length,
      no_start_date: acc.no_start_date + b.no_start_date.length,
    }),
    { expected: 0, with_slip: 0, missing: 0, no_start_date: 0 }
  );

  return NextResponse.json({
    data: {
      period: { year, month, cycle_start: cycle.start, cycle_end: cycle.end, pay_date: cycle.payDate, closed },
      buckets: data,
      totals,
    },
  });
}
