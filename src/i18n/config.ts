// 'my' (Burmese) is a PARTIAL locale for Burmese staff awaiting an HR position (role
// not_assign): only the baseline menus they can see are translated (my.json), everything
// else falls back to Thai (request.ts merges my.json over th.json).
export const locales = ['th', 'en', 'my'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'th';
