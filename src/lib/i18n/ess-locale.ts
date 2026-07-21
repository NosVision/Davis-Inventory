'use client';

import { useLocale } from 'next-intl';

/**
 * 4-way text picker for the ESS pages whose strings are self-contained in the component
 * (the deliberate pattern on /me — no message-catalog keys). th/en are required; my/lo are
 * optional and fall back to THAI (same fallback direction as the partial locale catalogs,
 * so a missing translation never surfaces English to a Burmese/Lao reader).
 */
export function pickEssText(locale: string, th: string, en: string, my?: string, lo?: string): string {
  if (locale === 'th') return th;
  if (locale === 'my') return my ?? th;
  if (locale === 'lo') return lo ?? th;
  return en;
}

/** Hook form: `const tx = useEssText(); tx('ไทย', 'English', 'မြန်မာ', 'ລາວ')`. */
export function useEssText(): (th: string, en: string, my?: string, lo?: string) => string {
  const locale = useLocale();
  return (th, en, my, lo) => pickEssText(locale, th, en, my, lo);
}
