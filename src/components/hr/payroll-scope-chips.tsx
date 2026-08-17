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

/** True when the listed people span more than one company — i.e. this venue mixes payrolls. */
export function spansMultipleCompanies(list: readonly PayrollScopeInfo[]): boolean {
  const seen = new Set<string>();
  for (const e of list) {
    if (e.company_name) seen.add(e.company_name);
    if (seen.size > 1) return true;
  }
  return false;
}

interface PayrollScopeChipsProps {
  emp: PayrollScopeInfo;
  /** Pass `spansMultipleCompanies(employees)` — a single-company list needs no company chip. */
  showCompany: boolean;
  isTh: boolean;
}

export function PayrollScopeChips({ emp, showCompany, isTh }: PayrollScopeChipsProps) {
  const company = showCompany && emp.company_name ? emp.company_name : null;
  const group = emp.payroll_group_name ?? null;
  if (!company && !group) return null;

  return (
    <>
      {company && (
        <span
          className="ml-1 inline-flex shrink-0 items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
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
