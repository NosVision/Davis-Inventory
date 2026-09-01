const thaiDateFormatter = new Intl.DateTimeFormat('th-TH', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'Asia/Bangkok',
});

const thaiDateTimeFormatter = new Intl.DateTimeFormat('th-TH', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Bangkok',
});

const thaiShortDateFormatter = new Intl.DateTimeFormat('th-TH', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  timeZone: 'Asia/Bangkok',
});

export function formatThaiDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return thaiDateFormatter.format(d);
}

export function formatThaiDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return thaiDateTimeFormatter.format(d);
}

export function formatThaiShortDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return thaiShortDateFormatter.format(d);
}

/**
 * 'YYYY-MM-DD' (or an ISO timestamp) → 'DD/MM/YYYY' — the date convention the HR screens read in
 * (payroll register, payslip, pay window; owner ask 2026-07-10).
 *
 * Sliced as text rather than parsed into a Date: a business date is already a Bangkok calendar
 * date, and re-parsing it only invites a timezone shifting it a day.
 */
export function formatDmy(date: string | null | undefined): string {
  if (!date) return '—';
  const s = String(date).slice(0, 10);
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}/${m}/${y}` : s;
}

export function formatNumber(num: number, decimals = 0): string {
  return num.toLocaleString('th-TH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a stock quantity / difference. Shows up to 2 decimals when the
 * value has a fractional part, otherwise renders as an integer.
 *
 * Stock columns are NUMERIC(10,2), so a value like 0.5 (POS) vs 0 (manual)
 * is real data — formatting it as "0" with formatNumber hides the
 * difference and makes "POS 0 / นับจริง 0 / -0 / -100%" rows look like a
 * bug to staff. Showing 2 decimals reveals the actual numbers ("0.5 vs 0").
 *
 * Tolerates floating-point dust under 0.005 by snapping to 0.
 */
export function formatQty(num: number | null | undefined): string {
  if (num === null || num === undefined) return '-';
  if (!Number.isFinite(num)) return '-';
  if (Math.abs(num) < 0.005) return formatNumber(0);
  const rounded = Math.round(num);
  if (Math.abs(num - rounded) < 0.005) return formatNumber(rounded);
  return formatNumber(num, 2);
}

/**
 * Format a signed difference with a leading '+' when positive, '-' when
 * negative, '0' when within rounding noise. Used by the comparison /
 * explanation pages so a 0.5 shortage doesn't render as "-0".
 */
export function formatSignedQty(num: number | null | undefined): string {
  if (num === null || num === undefined) return '-';
  if (!Number.isFinite(num)) return '-';
  if (Math.abs(num) < 0.005) return formatNumber(0);
  const formatted = formatQty(Math.abs(num));
  return num > 0 ? `+${formatted}` : `-${formatted}`;
}

export function formatCurrency(amount: number): string {
  return `฿${formatNumber(amount, 2)}`;
}

export function formatPercent(value: number): string {
  return `${formatNumber(value, 1)}%`;
}

/**
 * Calculate days until a target date.
 * Uses absolute UTC timestamps — timezone-independent because both
 * endpoints reference the same instant.
 */
export function daysUntil(date: string | Date): number {
  const target = new Date(date).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}
