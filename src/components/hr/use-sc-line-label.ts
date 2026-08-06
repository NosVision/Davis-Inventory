'use client';

import { useTranslations } from 'next-intl';
import { parseScLine, type ScLineRef } from '@/lib/hr/sc-line';

/**
 * Localized text for one SC/tip deduction line (see `parseScLine` for why the stored label can't
 * just be printed). Warning levels and leave types reuse the catalogs those features already own,
 * so a level or leave-type rename never has to be mirrored here.
 *
 * Anything human-authored (manual / ad-hoc / eval / stock-penalty lines) is returned untouched —
 * HR typed that text and it is already in their language.
 */
export interface ScLineLabelOptions {
  /**
   * Drop the category word when the caller already shows it (the SC console prints a coloured
   * source chip next to the line) — "หัก SC 50%" instead of "ใบเตือน: หัก SC 50%".
   */
  detailOnly?: boolean;
}

export function useScLineLabel(): (line: ScLineRef, opts?: ScLineLabelOptions) => string {
  const t = useTranslations('hr.serviceCharge');
  const tWarn = useTranslations('hr.warnings');
  const tLeave = useTranslations('hr.serviceCharge.leaveNames');

  return (line: ScLineRef, opts?: ScLineLabelOptions): string => {
    const parsed = parseScLine(line);
    const detailOnly = opts?.detailOnly === true;
    switch (parsed.kind) {
      case 'warning': {
        // `level_verbal` … `level_amount_baht`; an unknown level keeps its raw code.
        const level = parsed.level ? tWarn.has(`level_${parsed.level}`) ? tWarn(`level_${parsed.level}`) : parsed.level : null;
        if (!level) return detailOnly ? '' : t('srcWarning');
        return detailOnly ? level : `${t('srcWarning')}: ${level}`;
      }
      case 'absent':
        if (parsed.days == null) return detailOnly ? '' : t('srcAbsent');
        return t('lineDays', { name: detailOnly ? '' : t('srcAbsent'), days: parsed.days }).trim();
      case 'leave': {
        const name = parsed.code && tLeave.has(parsed.code) ? tLeave(parsed.code) : (parsed.code ?? t('srcLeave'));
        return parsed.days != null ? t('lineDays', { name, days: parsed.days }) : name;
      }
      case 'carry':
        if (detailOnly) return ''; // the chip already reads "… (ยกมา)"
        return parsed.family === 'warning'
          ? t('srcWarningCarry')
          : parsed.family === 'eval'
            ? t('srcEvalCarry')
            : t('srcStockPenaltyCarry');
      case 'raw':
        return parsed.text;
    }
  };
}
