import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { defaultLocale, locales, partialLocales, type Locale } from './config';

type Messages = Record<string, unknown>;

// Overlay partial translations onto the Thai base so any key missing from the partial
// locale renders in Thai instead of throwing MISSING_MESSAGE.
function deepMerge(base: Messages, overlay: Messages): Messages {
  const out: Messages = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const prev = out[key];
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) &&
      prev && typeof prev === 'object' && !Array.isArray(prev)
        ? deepMerge(prev as Messages, value as Messages)
        : value;
  }
  return out;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get('NEXT_LOCALE')?.value;
  const locale: Locale = (locales as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : defaultLocale;

  // Partial menu-only locales (Burmese/Lao) — merge over the Thai base.
  if (partialLocales.includes(locale)) {
    const [th, partial] = await Promise.all([
      import('../messages/th.json'),
      import(`../messages/${locale}.json`),
    ]);
    return { locale, messages: deepMerge(th.default as Messages, partial.default as Messages) as never };
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
