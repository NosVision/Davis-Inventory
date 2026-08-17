'use client';

/**
 * Chips explaining why someone on THIS venue's roster/timesheet is missing from its payrun.
 *
 * The surfaces are keyed differently and always have been: the timesheet and the store roster
 * list a venue's `user_stores` members, while a payrun is generated per COMPANY and then split
 * by payroll group. The accounting team, for instance, are members of five venues but belong to
 * one company and one group — so they appear on five timesheets and on exactly one payslip run.
 * HR read the difference as missing data (owner report 2026-08-17); these chips say it on the
 * row itself instead of leaving it to be worked out.
 *
 * Deliberately NOT shown when there is nothing to explain: the company chip only appears once a
 * list actually mixes companies, and the group chip only for the few people who have a group.
 */

export interface PayrollScopeInfo {
  /** Company that owns this person's payrun (hr_employees.company_id). */
  company_name?: string | null;
  /** Payroll slice inside that company — a named group is generated as its own payrun. */
  payroll_group_name?: string | null;
}

/** Strip the corporate wrapper so a chip stays chip-sized; the full name lives in the tooltip. */
export function shortCompany(name: string): string {
  const trimmed = name
    .replace(/^บริษัท\s*/, '')
    .replace(/^(?:บมจ|บจก|หจก)\.?\s*/, '')
    .replace(/\s*จ(?:ำ|ํา)กัด\s*\(มหาชน\)\s*$/, '')
    .replace(/\s*จ(?:ำ|ํา)กัด\s*$/, '')
    .replace(/,?\s*(?:Co\.,?\s*Ltd\.?|Company Limited|Ltd\.?)\s*$/i, '')
    .trim();
  return trimmed || name;
}

/**
 * The company this list is really "about" — the one most of its people belong to.
 *
 * Chipping every row of a mixed venue was the first attempt and it was wrong: at Baccarat it put a
 * long "บัคคารัต บางกอก บาร์ และ เรสเทอรเริน" on all 21 of that company's own staff to flag 4
 * visitors, and the employee names were squeezed to "นาง…" (owner report 2026-08-17). The signal is
 * the exception, so only the exceptions are marked.
 *
 * `stores` carries no company, so the venue's own company has to be inferred from who works there.
 * A tie returns null and everyone is chipped — with two payrolls equally represented there is no
 * "visiting" company, and saying so is better than picking one arbitrarily.
 */
export function dominantCompany(list: readonly PayrollScopeInfo[]): string | null {
  const count = new Map<string, number>();
  for (const e of list) {
    if (!e.company_name) continue;
    count.set(e.company_name, (count.get(e.company_name) ?? 0) + 1);
  }
  if (count.size < 2) return [...count.keys()][0] ?? null;
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0][1] === ranked[1][1] ? null : ranked[0][0];
}

interface PayrollScopeChipsProps {
  emp: PayrollScopeInfo;
  /**
   * The venue's own company, from {@link dominantCompany}. Anyone else's company is named on their
   * row; the venue's own staff carry no chip, which is what keeps the column readable.
   */
  homeCompany: string | null;
  isTh: boolean;
}

export function PayrollScopeChips({ emp, homeCompany, isTh }: PayrollScopeChipsProps) {
  const company = emp.company_name && emp.company_name !== homeCompany ? emp.company_name : null;
  const group = emp.payroll_group_name ?? null;
  if (!company && !group) return null;

  return (
    <>
      {company && (
        // Capped: a full legal name must never be allowed to push the person's own name out of view.
        <span
          className="ml-1 inline-flex max-w-[7rem] shrink-0 items-center truncate rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
          title={
            isTh
              ? `สังกัด ${company} — เงินเดือนอยู่ใน payrun ของบริษัทนี้ ไม่ใช่ของสาขา`
              : `Employed by ${company} — paid on that company's payrun, not this venue's`
          }
        >
          {shortCompany(company)}
        </span>
      )}
      {group && (
        <span
          className="ml-1 inline-flex shrink-0 items-center rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
          title={
            isTh
              ? `กลุ่มเงินเดือน "${group}" — ออก payrun แยกใบจากพนักงานที่ไม่มีกลุ่ม`
              : `Payroll group "${group}" — generated as its own payrun, separate from ungrouped staff`
          }
        >
          {group}
        </span>
      )}
    </>
  );
}
