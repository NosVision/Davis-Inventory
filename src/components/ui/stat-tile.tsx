import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

// StatTile / KpiRow — the shared "lead with your key numbers" primitive (Tier 0), extracted from
// the hr/dashboard KPI tiles so every money/summary page can surface its hero figures the same
// way instead of burying them as gray table text. `value` accepts a MoneyValue for emphasis.
type Tone = 'default' | 'accent' | 'good' | 'warn' | 'serious' | 'critical';

const toneChip: Record<Tone, string> = {
  default: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  accent: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
  good: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  warn: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  serious: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
  critical: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
};

interface StatTileProps {
  label: string;
  /** a number/string, or a <MoneyValue> for emphasized currency */
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  hint?: string;
  /** makes the whole tile a link (used for actionable KPIs / pending counts) */
  href?: string;
  /** makes the whole tile a button (e.g. a clickable filter) — ignored if `href` is set */
  onClick?: () => void;
  /** highlight the tile as the active selection (for filter tiles) */
  active?: boolean;
  className?: string;
}

export function StatTile({ label, value, icon: Icon, tone = 'default', hint, href, onClick, active, className }: StatTileProps) {
  const interactive = !!href || !!onClick;
  const inner = (
    <div
      className={cn(
        'rounded-xl border bg-white p-4 dark:bg-gray-800',
        active
          ? 'border-indigo-400 ring-2 ring-indigo-200 dark:border-indigo-500 dark:ring-indigo-900/50'
          : 'border-gray-200 dark:border-gray-700',
        interactive && 'transition hover:border-indigo-300 hover:shadow-sm dark:hover:border-indigo-500',
        className
      )}
    >
      {Icon && (
        <div className={cn('mb-2 flex h-9 w-9 items-center justify-center rounded-lg', toneChip[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{value}</div>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block">
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className="block w-full text-left">
        {inner}
      </button>
    );
  }
  return inner;
}

interface KpiRowProps {
  children: React.ReactNode;
  /** column count at the widest breakpoint (2 on mobile always). Default 4. */
  cols?: 3 | 4 | 5 | 6;
  className?: string;
}
const colsCls: Record<NonNullable<KpiRowProps['cols']>, string> = {
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  5: 'sm:grid-cols-3 lg:grid-cols-5',
  6: 'sm:grid-cols-3 lg:grid-cols-6',
};

export function KpiRow({ children, cols = 4, className }: KpiRowProps) {
  return <div className={cn('grid grid-cols-2 gap-3', colsCls[cols], className)}>{children}</div>;
}
