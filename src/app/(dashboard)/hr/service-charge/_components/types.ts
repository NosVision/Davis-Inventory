// Shared types for the HR Service Charge page (P4.1, §H).
// Money is always integer satang; the UI divides by 100 for baht display.

export interface StoreOpt {
  id: string;
  store_code: string;
  store_name: string;
}

export type ScStatus = 'draft' | 'finalized';

export interface ScPool {
  id: string;
  store_id: string;
  period_month: string;
  total_satang: number;
  status: ScStatus;
  pay_date: string | null;
  notes: string | null;
  announced_at?: string | null;
  announce_message?: string | null;
}

export type ScSourceType =
  | 'warning' | 'warning_carry'
  | 'leave' | 'absent' | 'late'
  | 'eval' | 'eval_carry'
  | 'stock_penalty' | 'stock_penalty_carry'
  | 'manual';

export interface ScDeduction {
  id: string;
  source_type: ScSourceType;
  label: string;
  amount_satang: number;
  carry_satang: number;
  note: string | null;
  auto: boolean;
}

export interface ScEmployeeRef {
  id: string;
  display_name: string | null;
  username: string | null;
}

/** Store employee enriched with payroll identity (client ask 2026-07-21: HR pays against the
 *  REAL full name + nickname + position + start date, not the app nickname alone). */
export interface ScEmployeeInfo {
  id: string; // profile id
  nickname: string | null; // profiles.display_name / username (app name)
  fullName: string | null; // hr_employees.full_name (payroll name)
  position: string | null;
  startDate: string | null; // YYYY-MM-DD
}

export interface ScAllocation {
  id: string;
  user_id: string;
  allocated_satang: number;
  employee: ScEmployeeRef;
  deductions: ScDeduction[];
  net_satang: number;
}

export interface ScTotals {
  allocated: number;
  deducted: number;
  net: number;
}

export interface ScData {
  pool: ScPool;
  allocations: ScAllocation[];
  totals: ScTotals;
  /** The evaluation that feeds this pool — the PREVIOUS month's, since it closes around the 10th
   *  and docks the pool transferred on the 15th. 'missing' = none created yet. */
  evaluation?: {
    period_month: string;
    pool_month: string;
    total: number;
    closed: number;
    state: 'missing' | 'open' | 'closed';
  };
}

/** One rendered table row: an employee at the store merged with any existing allocation. */
export interface ScRow {
  userId: string;
  /** primary display name — the payroll full name when known, else the app nickname */
  name: string;
  nickname: string | null;
  position: string | null;
  startDate: string | null;
  allocation: ScAllocation | null;
}
