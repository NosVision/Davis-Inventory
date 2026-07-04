import { cn } from '@/lib/utils/cn';

// FilterBar / FilterField — the shared filter-row primitive (Tier 0). Standardizes the
// filter/search controls above a list so they wrap cleanly on 320–375px instead of the ad-hoc
// grids that leave half-empty columns or overflow. Pair the control inside with the `.control`
// class (or a <Select>) for a consistent field look.
export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-end gap-2 sm:gap-3', className)}>{children}</div>;
}

interface FilterFieldProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

export function FilterField({ label, children, className }: FilterFieldProps) {
  return (
    <label className={cn('flex min-w-0 flex-col text-xs font-medium text-gray-600 dark:text-gray-400', className)}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
