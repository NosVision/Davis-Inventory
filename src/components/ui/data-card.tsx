import Link from 'next/link';
import { cn } from '@/lib/utils/cn';

// DataCard / DataList — the shared list-row primitive (Tier 0) that replaces the flat
// `divide-y` gray card lists across every HR/ESS queue page. A row leads with a primary title,
// carries an emphasized `value` (a MoneyValue / big count) and a `status` badge on the trailing
// edge, secondary meta below, and right-aligned `actions`. A colored left rail (`accent`) turns
// status into a scannable spine so the eye can triage a queue without reading every field.
type Accent = 'none' | 'neutral' | 'accent' | 'good' | 'warn' | 'serious' | 'critical';

const railCls: Record<Accent, string> = {
  none: '',
  neutral: 'before:bg-gray-300 dark:before:bg-gray-600',
  accent: 'before:bg-indigo-500',
  good: 'before:bg-emerald-500',
  warn: 'before:bg-amber-500',
  serious: 'before:bg-orange-500',
  critical: 'before:bg-red-500',
};

interface DataCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** extra meta rendered under the title (chips, dates, reason…) */
  children?: React.ReactNode;
  /** emphasized trailing content — a <MoneyValue>, a big count, etc. */
  value?: React.ReactNode;
  /** a <StatusBadge> shown on the trailing top edge */
  status?: React.ReactNode;
  /** right-aligned action controls (buttons) */
  actions?: React.ReactNode;
  /** colored left rail signalling row status at a glance */
  accent?: Accent;
  href?: string;
  onClick?: () => void;
  className?: string;
}

export function DataCard({
  title,
  subtitle,
  children,
  value,
  status,
  actions,
  accent = 'none',
  href,
  onClick,
  className,
}: DataCardProps) {
  const interactive = !!(href || onClick);
  const body = (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-gray-200 bg-white p-3 sm:p-4 dark:border-gray-700 dark:bg-gray-800',
        accent !== 'none' && 'before:absolute before:inset-y-0 before:left-0 before:w-1',
        railCls[accent],
        interactive &&
          'text-left transition hover:border-indigo-300 hover:shadow-sm dark:hover:border-indigo-500',
        accent !== 'none' && 'pl-4 sm:pl-5',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="font-semibold text-gray-900 dark:text-white">{title}</div>
          {subtitle && <div className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</div>}
          {children && <div className="text-xs text-gray-500 dark:text-gray-400">{children}</div>}
        </div>
        {(status || value) && (
          <div className="flex shrink-0 flex-col items-end gap-1 text-right">
            {status}
            {value}
          </div>
        )}
      </div>
      {actions && <div className="mt-3 flex flex-wrap justify-end gap-2">{actions}</div>}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block w-full">
        {body}
      </button>
    );
  }
  return body;
}

export function DataList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('space-y-2', className)}>{children}</div>;
}
