'use client';

import { createContext, useContext } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils/cn';

// DataCard / DataList — the shared list-row primitive (Tier 0). A row leads with a primary title,
// carries an emphasized `value` and a `status` badge on the trailing edge, secondary meta below,
// right-aligned `actions`, and a colored left rail (`accent`) that turns status into a scannable spine.
//
// Two densities, switched by <DataList compact>: 'cards' (spacious bordered cards, default) and
// 'compact' (dense single-line rows inside one bordered, divided box — a table-like view for when a
// queue has many items). DataCard reads the density from context so pages only toggle it on DataList.
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

const CompactContext = createContext(false);

interface DataCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** extra meta rendered under the title (chips, dates, reason…) — hidden in compact view */
  children?: React.ReactNode;
  /** emphasized trailing content — a <MoneyValue>, a big count, etc. */
  value?: React.ReactNode;
  /** a <StatusBadge> shown on the trailing edge */
  status?: React.ReactNode;
  /** right-aligned action controls (buttons) */
  actions?: React.ReactNode;
  /** colored left rail signalling row status at a glance */
  accent?: Accent;
  href?: string;
  onClick?: () => void;
  className?: string;
}

export function DataCard(props: DataCardProps) {
  const compact = useContext(CompactContext);
  return compact ? <CompactRow {...props} /> : <FullCard {...props} />;
}

function wrap(interactiveHref: string | undefined, onClick: (() => void) | undefined, body: React.ReactNode) {
  if (interactiveHref) {
    return (
      <Link href={interactiveHref} className="block">
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block w-full text-left">
        {body}
      </button>
    );
  }
  return body;
}

function FullCard({ title, subtitle, children, value, status, actions, accent = 'none', href, onClick, className }: DataCardProps) {
  const interactive = !!(href || onClick);
  const body = (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-gray-200 bg-white p-3 sm:p-4 dark:border-gray-700 dark:bg-gray-800',
        accent !== 'none' && 'before:absolute before:inset-y-0 before:left-0 before:w-1',
        railCls[accent],
        accent !== 'none' && 'pl-4 sm:pl-5',
        interactive && 'transition hover:border-indigo-300 hover:shadow-sm dark:hover:border-indigo-500',
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
  return wrap(href, onClick, body);
}

function CompactRow({ title, subtitle, value, status, actions, accent = 'none', href, onClick, className }: DataCardProps) {
  const interactive = !!(href || onClick);
  const body = (
    <div
      className={cn(
        'relative flex items-center gap-3 bg-white px-3 py-2 dark:bg-gray-800',
        accent !== 'none' && 'before:absolute before:inset-y-0 before:left-0 before:w-1 pl-4',
        railCls[accent],
        interactive && 'transition hover:bg-gray-50 dark:hover:bg-gray-700/50',
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-sm font-medium text-gray-900 dark:text-white">{title}</span>
        {subtitle && <span className="hidden shrink-0 truncate text-xs text-gray-500 sm:inline dark:text-gray-400">{subtitle}</span>}
      </div>
      {status && <div className="shrink-0">{status}</div>}
      {value && <div className="shrink-0 text-sm">{value}</div>}
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
  return wrap(href, onClick, body);
}

interface DataListProps {
  children: React.ReactNode;
  /** dense table-like rows in one bordered box instead of spaced cards */
  compact?: boolean;
  className?: string;
}

export function DataList({ children, compact = false, className }: DataListProps) {
  return (
    <CompactContext.Provider value={compact}>
      <div
        className={cn(
          compact
            ? 'divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700'
            : 'space-y-2',
          className
        )}
      >
        {children}
      </div>
    </CompactContext.Provider>
  );
}
