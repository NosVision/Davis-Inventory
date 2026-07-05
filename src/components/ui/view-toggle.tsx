'use client';

import { useEffect, useState } from 'react';
import { LayoutGrid, Rows3 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

// ViewToggle / useViewMode — a segmented cards⇄compact switch for list pages, so a long queue can
// collapse from spacious cards to a dense table-like view. useViewMode persists the choice per page
// key in localStorage (read in an effect to avoid SSR hydration mismatch).
export type ViewMode = 'cards' | 'compact';

export function useViewMode(key: string, initial: ViewMode = 'cards') {
  const [mode, setMode] = useState<ViewMode>(initial);
  useEffect(() => {
    try {
      const v = localStorage.getItem('viewmode:' + key);
      if (v === 'cards' || v === 'compact') setMode(v);
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, [key]);
  const set = (m: ViewMode) => {
    setMode(m);
    try {
      localStorage.setItem('viewmode:' + key, m);
    } catch {
      /* ignore */
    }
  };
  return [mode, set] as const;
}

interface ViewToggleProps {
  value: ViewMode;
  onChange: (m: ViewMode) => void;
  /** accessible labels; default Thai */
  labels?: { cards: string; compact: string };
  className?: string;
}

export function ViewToggle({ value, onChange, labels, className }: ViewToggleProps) {
  const cardsLabel = labels?.cards ?? 'การ์ด';
  const compactLabel = labels?.compact ?? 'ตาราง';
  const btn = (m: ViewMode, Icon: typeof LayoutGrid, label: string) => (
    <button
      type="button"
      onClick={() => onChange(m)}
      aria-pressed={value === m}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
        value === m
          ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-700 dark:text-indigo-400'
          : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800', className)}>
      {btn('cards', LayoutGrid, cardsLabel)}
      {btn('compact', Rows3, compactLabel)}
    </div>
  );
}
