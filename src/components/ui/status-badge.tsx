import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

// StatusBadge — status pill that carries color + label + (optional) icon, never color alone
// (a11y). Design-system primitive (Tier 0) replacing `Badge size="sm"` at text-[10px] with a
// readable, semantic tone scale. Map your domain status → a tone at the call site.
export type StatusTone = 'neutral' | 'info' | 'good' | 'warn' | 'serious' | 'critical';

const toneCls: Record<StatusTone, string> = {
  neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  good: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  warn: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  serious: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  critical: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

interface StatusBadgeProps {
  tone: StatusTone;
  label: string;
  icon?: LucideIcon;
  className?: string;
}

export function StatusBadge({ tone, label, icon: Icon, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        toneCls[tone],
        className
      )}
    >
      {Icon && <Icon className="h-3 w-3 shrink-0" />}
      {label}
    </span>
  );
}
