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
}

export type ScSourceType =
  | 'warning' | 'warning_carry'
  | 'leave' | 'late'
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
}

/** One rendered table row: an employee at the store merged with any existing allocation. */
export interface ScRow {
  userId: string;
  name: string;
  allocation: ScAllocation | null;
}
