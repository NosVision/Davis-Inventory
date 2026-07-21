// 'my' (Burmese) and 'lo' (Lao) are PARTIAL locales for migrant front-line staff: only the
// menus those roles see are translated (my.json / lo.json), everything else falls back to
// Thai (request.ts merges the partial file over th.json). Available to every role — the
// picker is user-driven and an untranslated key simply renders Thai.
export const locales = ['th', 'en', 'my', 'lo'] as const;
export const partialLocales: readonly string[] = ['my', 'lo'];
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'th';
