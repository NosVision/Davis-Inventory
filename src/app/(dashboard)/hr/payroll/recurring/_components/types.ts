export interface GridEmployee {
  id: string; // hr_employees.id
  profile_id: string;
  name: string;
  /** ชื่อเล่น (profiles.display_name) when it differs from the payroll name — see lib/hr/employee-name. */
  nickname: string | null;
  position: string | null;
  status: string;
}

export interface RecurringItem {
  id: string;
  employee_id: string;
  kind: 'earning' | 'deduction';
  code: string;
  label: string;
  amount_satang: number;
  active: boolean;
  note: string | null;
  start_period: string | null; // 'YYYY-MM' | null = since forever
  end_period: string | null; // 'YYYY-MM' | null = perpetual
}
