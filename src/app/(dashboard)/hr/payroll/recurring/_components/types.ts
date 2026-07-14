export interface GridEmployee {
  id: string; // hr_employees.id
  profile_id: string;
  name: string;
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
