'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Languages, Check } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useAppStore } from '@/stores/app-store';
import { locales, type Locale } from '@/i18n/config';

// Native-script names — a reader who can't parse Thai/English still finds their language.
const NATIVE_NAMES: Record<Locale, string> = {
  th: 'ไทย',
  en: 'English',
  my: 'မြန်မာ',
  lo: 'ລາວ',
};

interface LanguageSwitcherProps {
  collapsed?: boolean;
  className?: string;
  /** which way the picker opens; 'up' for footer placements (sidebar/mobile drawer), 'down' inside the top bar menu */
  direction?: 'up' | 'down';
}

// Dropdown language picker (owner ask 2026-07-21 — was a cycle-toggle, unusable with 4
// languages). Burmese/Lao are partial menu-only locales; untranslated keys fall back to Thai.
export function LanguageSwitcher({ collapsed = false, className, direction = 'up' }: LanguageSwitcherProps) {
  const locale = useLocale();
  const router = useRouter();
  const { setLocale } = useAppStore();
  const [open, setOpen] = useState(false);

  const pick = (next: Locale) => {
    setOpen(false);
    if (next === locale) return;
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;SameSite=Lax`;
    setLocale(next);
    router.refresh();
  };

  return (
    <div className="relative">
      {open && (
        // click-away backdrop — the picker lives inside menus/footers, so a fixed overlay
        // is the only reliable outside-click catcher across all three placements
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={NATIVE_NAMES[locale as Locale] ?? 'Language'}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm',
          'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
          'transition-colors duration-150',
          collapsed && 'justify-center px-2',
          className
        )}
      >
        <Languages className="h-[18px] w-[18px] shrink-0" />
        {!collapsed && <span>{NATIVE_NAMES[locale as Locale] ?? locale.toUpperCase()}</span>}
      </button>
      {open && (
        <ul
          role="listbox"
          className={cn(
            'absolute z-50 min-w-[10rem] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800',
            direction === 'up' ? 'bottom-full left-0 mb-1' : 'right-0 top-full mt-1'
          )}
        >
          {locales.map((l) => (
            <li key={l}>
              <button
                type="button"
                role="option"
                aria-selected={l === locale}
                onClick={() => pick(l)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors',
                  l === locale
                    ? 'font-semibold text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/50'
                )}
              >
                {NATIVE_NAMES[l]}
                {l === locale && <Check className="h-4 w-4 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
