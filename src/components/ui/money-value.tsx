import { cn } from '@/lib/utils/cn';
import { formatBaht } from '@/lib/pos/money';

// MoneyValue — the shared way to render a satang amount as ฿ with the right emphasis.
// Design-system primitive (Tier 0): kills ad-hoc `formatBaht()` spans of varying weight and
// makes the most important number on a money page a real hero figure. Sign is rendered
// explicitly (−฿ / +฿) so it never reads as "฿-…", and `signed` colors by direction.
type Emphasis = 'hero' | 'kpi' | 'strong' | 'inline';
type Tone = 'default' | 'good' | 'critical' | 'muted';

interface MoneyValueProps {
  satang: number;
  emphasis?: Emphasis;
  /** show an explicit +/- and color green/red by direction (for deltas / net effects) */
  signed?: boolean;
  /** force a tone; ignored when `signed` (sign drives the color) */
  tone?: Tone;
  className?: string;
}

// Responsive so a 7-digit ฿ amount (an unbreakable comma-grouped token) shrinks to fit a narrow
// KPI card instead of overflowing it, while staying prominent on wider screens (owner report
// 2026-07-10). Never truncated — the whole number always shows.
const sizeCls: Record<Emphasis, string> = {
  hero: 'text-lg font-bold sm:text-2xl xl:text-3xl',
  kpi: 'text-base font-bold sm:text-xl xl:text-2xl',
  strong: 'text-base font-semibold sm:text-lg',
  inline: 'font-medium',
};
const toneCls: Record<Tone, string> = {
  default: 'text-gray-900 dark:text-white',
  good: 'text-emerald-600 dark:text-emerald-400',
  critical: 'text-red-600 dark:text-red-400',
  muted: 'text-gray-500 dark:text-gray-400',
};

export function MoneyValue({ satang, emphasis = 'inline', signed = false, tone = 'default', className }: MoneyValueProps) {
  const resolvedTone: Tone = signed ? (satang < 0 ? 'critical' : satang > 0 ? 'good' : 'muted') : tone;
  const sign = satang < 0 ? '−' : signed && satang > 0 ? '+' : '';
  return (
    <span className={cn('tabular-nums', sizeCls[emphasis], toneCls[resolvedTone], className)}>
      {sign}฿{formatBaht(Math.abs(satang))}
    </span>
  );
}
