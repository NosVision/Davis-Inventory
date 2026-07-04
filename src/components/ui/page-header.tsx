import { cn } from '@/lib/utils/cn';

// PageHeader / SectionHeading — the shared page-top primitive (Tier 0). Every HR/ESS page hand-rolls
// an h1 + subtitle + a flex actions row; this standardizes the spacing, responsive wrap, and dark
// styling so pages stop drifting. `children` is for an optional sub-line (e.g. a compare link).
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** right-aligned controls (filters, primary action) — wraps under the title on small screens */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, children, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-end gap-2">{actions}</div>}
    </div>
  );
}

interface SectionHeadingProps {
  title: string;
  /** right-aligned slot (a button, a count, a link) */
  extra?: React.ReactNode;
  className?: string;
}

export function SectionHeading({ title, extra, className }: SectionHeadingProps) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <h2 className="text-base font-bold text-gray-900 dark:text-white">{title}</h2>
      {extra}
    </div>
  );
}
