'use client';

import { useLocale } from 'next-intl';
import { Archive } from 'lucide-react';

// Read-only view of ONE archived (legacy) payslip from hr_imported_payslips. These
// predate the live engine, so the shape is the sheet's own columns — not the engine's
// PayslipDetailData. Self-contained locale strings (matches the ESS/HR component style).

export interface ImportedSlip {
  id: string;
  company_id?: string;
  employee_id?: string | null;
  pending_identity_id?: string | null;
  period_year: number;
  period_month: number;
  sheet_ref?: string | null;
  name_th: string | null;
  name_en: string | null;
  nickname: string | null;
  position_text: string | null;
  rate_satang: number | null;
  worked_days: number | null;
  off_days: number | null;
  period_days: number | null;
  ot_hours: number | null;
  ot_pay_satang: number | null;
  holiday_pay_satang: number | null;
  transportation_satang: number | null;
  pay_transportation_satang: number | null;
  service_satang: number | null;
  leaves: Record<string, number | null> | null;
  deduction_satang: number | null;
  deduction_breakdown: Record<string, number | null> | null;
  gross_satang: number | null;
  sso5_satang: number | null;
  sso3_satang: number | null;
  tax_satang: number | null;
  net_satang: number | null;
}

const MONTHS_TH = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_EN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function periodLabel(year: number, month: number, isTh: boolean): string {
  const m = (isTh ? MONTHS_TH : MONTHS_EN)[month] ?? String(month).padStart(2, '0');
  return `${m} ${year}`;
}

const baht = (satang: number | null | undefined): string =>
  satang == null ? '—' : (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function SlipRow({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'good' | 'critical' }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span
        className={[
          strong ? 'text-base font-semibold' : 'font-medium',
          tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'critical' ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-gray-100',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
}

export function ImportedPayslipView({ data }: { data: ImportedSlip }) {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? {
        archive: 'ข้อมูลนำเข้า (ย้อนหลัง)', name: 'ชื่อ', position: 'ตำแหน่ง', period: 'งวด',
        earnings: 'รายได้', salary: 'เงินเดือน', workedDays: 'วันทำงาน', otHours: 'ชม. OT',
        otPay: 'ค่า OT', holidayPay: 'ค่าทำงานวันหยุด', transport: 'ค่าเดินทาง', service: 'ค่าเซอร์วิส',
        deductions: 'รายการหัก', sso: 'ประกันสังคม', wht3: 'ภาษีหัก ณ ที่จ่าย 3%', tax: 'ภาษีเงินได้ (ภ.ง.ด.1)', otherDed: 'หักอื่นๆ',
        gross: 'รวมรายได้', net: 'เงินสุทธิ', days: 'วัน', hours: 'ชม.',
      }
    : {
        archive: 'Imported (historical)', name: 'Name', position: 'Position', period: 'Period',
        earnings: 'Earnings', salary: 'Salary', workedDays: 'Worked days', otHours: 'OT hours',
        otPay: 'OT pay', holidayPay: 'Holiday pay', transport: 'Transport', service: 'Service charge',
        deductions: 'Deductions', sso: 'Social security', wht3: 'Withholding tax 3%', tax: 'Income tax (PND1)', otherDed: 'Other deductions',
        gross: 'Gross', net: 'Net pay', days: 'd', hours: 'h',
      };

  const name = data.name_th || data.name_en || data.nickname || '—';
  // sso5 = real social security (5%); sso3 = the foreigner withholding-tax 3% group — NOT social
  // security (the legacy sheet's "SS 3%" column is a misnomer), so it renders as withholding tax.
  const ssoSatang = data.sso5_satang ?? 0;
  const wht3Satang = data.sso3_satang ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">{name}</div>
          {data.position_text && <div className="truncate text-sm text-gray-500 dark:text-gray-400">{data.position_text}</div>}
          <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{L.period}: {periodLabel(data.period_year, data.period_month, isTh)}</div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          <Archive className="h-3 w-3" /> {L.archive}
        </span>
      </div>

      <section>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{L.earnings}</h4>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          <SlipRow label={L.salary} value={baht(data.rate_satang)} />
          {data.worked_days != null && (
            <SlipRow label={L.workedDays} value={`${data.worked_days}${data.period_days != null ? ` / ${data.period_days}` : ''} ${L.days}`} />
          )}
          {(data.ot_hours ?? 0) > 0 && <SlipRow label={L.otHours} value={`${data.ot_hours} ${L.hours}`} />}
          {(data.ot_pay_satang ?? 0) > 0 && <SlipRow label={L.otPay} value={baht(data.ot_pay_satang)} />}
          {(data.holiday_pay_satang ?? 0) > 0 && <SlipRow label={L.holidayPay} value={baht(data.holiday_pay_satang)} />}
          {(data.transportation_satang ?? 0) > 0 && <SlipRow label={L.transport} value={baht(data.transportation_satang)} />}
          {(data.service_satang ?? 0) > 0 && <SlipRow label={L.service} value={baht(data.service_satang)} />}
          <SlipRow label={L.gross} value={baht(data.gross_satang)} strong />
        </div>
      </section>

      <section>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{L.deductions}</h4>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {ssoSatang > 0 && <SlipRow label={L.sso} value={baht(ssoSatang)} tone="critical" />}
          {wht3Satang > 0 && <SlipRow label={L.wht3} value={baht(wht3Satang)} tone="critical" />}
          {(data.tax_satang ?? 0) > 0 && <SlipRow label={L.tax} value={baht(data.tax_satang)} tone="critical" />}
          {(data.deduction_satang ?? 0) > 0 && <SlipRow label={L.otherDed} value={baht(data.deduction_satang)} tone="critical" />}
        </div>
      </section>

      <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-900/20">
        <SlipRow label={L.net} value={baht(data.net_satang)} strong tone="good" />
      </div>
    </div>
  );
}
