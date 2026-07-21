'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useAppStore } from '@/stores/app-store';
import { useAuthStore } from '@/stores/auth-store';
import type { Locale } from '@/i18n/config';

interface LanguageSwitcherProps {
  collapsed?: boolean;
  className?: string;
}

export function LanguageSwitcher({ collapsed = false, className }: LanguageSwitcherProps) {
  const locale = useLocale();
  const router = useRouter();
  const { setLocale } = useAppStore();
  const { user } = useAuthStore();

  // Burmese is a menu-only partial locale for staff awaiting an HR position (role
  // not_assign) — mostly Burmese workers who self-registered. Everyone else keeps TH↔EN.
  const order: Locale[] = user?.role === 'not_assign' ? ['th', 'en', 'my'] : ['th', 'en'];
  const next: Locale = order[(order.indexOf(locale as Locale) + 1) % order.length] ?? 'th';
  const NEXT_TITLE: Record<Locale, string> = {
    th: 'เปลี่ยนเป็นภาษาไทย',
    en: 'Switch to English',
    my: 'မြန်မာဘာသာသို့ ပြောင်းရန်',
  };

  const toggle = () => {
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;SameSite=Lax`;
    setLocale(next);
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={NEXT_TITLE[next]}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm',
        'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
        'transition-colors duration-150',
        collapsed && 'justify-center px-2',
        className
      )}
    >
      <Languages className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && (
        <span>{next.toUpperCase()}</span>
      )}
    </button>
  );
}
