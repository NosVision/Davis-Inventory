'use client';

import { useTranslations } from 'next-intl';
import { Sparkles, AlertTriangle, Info } from 'lucide-react';
import { ScoreRing } from '@/components/ui';
import { computeAttendanceScore, type ScoreBand } from '@/lib/hr/attendance-score';
import type { DaySummary } from '@/components/hr/timesheet-parts';

// "ดัชนีการทำงาน" — friendly attendance index over the employee's own timesheet range
// (owner ask 2026-07-05): ring score + component bars + plain-language recommendations.
// Pure display: all scoring rules live in lib/hr/attendance-score (unit-asserted).
const BAND_TONE: Record<ScoreBand, 'good' | 'accent' | 'warn' | 'critical'> = {
  excellent: 'good',
  good: 'accent',
  fair: 'warn',
  poor: 'critical',
};
const BAND_TEXT: Record<ScoreBand, string> = {
  excellent: 'text-emerald-600 dark:text-emerald-400',
  good: 'text-indigo-600 dark:text-indigo-400',
  fair: 'text-amber-600 dark:text-amber-400',
  poor: 'text-red-600 dark:text-red-400',
};
const BAR_FILL: Record<ScoreBand, string> = {
  excellent: 'bg-emerald-500',
  good: 'bg-indigo-500',
  fair: 'bg-amber-500',
  poor: 'bg-red-500',
};

function Bar({ label, value }: { label: string; value: number }) {
  const band = value >= 90 ? 'excellent' : value >= 75 ? 'good' : value >= 60 ? 'fair' : 'poor';
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[11px]">
        <span className="text-gray-500 dark:text-gray-400">{label}</span>
        <span className="font-semibold text-gray-700 dark:text-gray-200">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
        <div className={`h-full rounded-full ${BAR_FILL[band as ScoreBand]}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function AttendanceScoreCard({ days, today }: { days: DaySummary[]; today: string }) {
  const t = useTranslations('hr.timesheet');

  // Past (or today) scheduled working days only — future rows must not dilute the score.
  const past = days.filter((d) => d.business_date <= today);
  const workdays = past.filter((d) => d.scheduled && !d.is_day_off);
  const score = computeAttendanceScore({
    scheduledDays: workdays.length,
    absentDays: workdays.filter((d) => d.absent).length,
    lateDays: workdays.filter((d) => (d.late_min ?? 0) > 0).length,
    lateMinutes: workdays.reduce((acc, d) => acc + (d.late_min ?? 0), 0),
    incompleteDays: workdays.filter((d) => d.incomplete && !d.absent).length,
    otMinutes: past.reduce((acc, d) => acc + (d.ot_min ?? 0), 0),
  });

  if (!score) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{t('scoreTitle')}</h2>
      <div className="flex items-center gap-4">
        <ScoreRing
          pct={score.overall}
          size={104}
          tone={BAND_TONE[score.band]}
          label={String(score.overall)}
          caption={t('scoreOutOf')}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p className={`text-sm font-bold ${BAND_TEXT[score.band]}`}>{t(`band_${score.band}`)}</p>
          <Bar label={t('compPunctuality')} value={score.components.punctuality} />
          <Bar label={t('compAttendance')} value={score.components.attendance} />
          <Bar label={t('compCompleteness')} value={score.components.completeness} />
        </div>
      </div>
      <ul className="mt-3 space-y-1.5 border-t border-gray-100 pt-3 dark:border-gray-700/60">
        {score.recommendations.map((r) => {
          const Icon = r.key === 'perfect' || r.key === 'otHigh' ? (r.key === 'perfect' ? Sparkles : Info) : AlertTriangle;
          const color =
            r.key === 'perfect'
              ? 'text-emerald-500'
              : r.key === 'otHigh'
                ? 'text-sky-500'
                : 'text-amber-500';
          return (
            <li key={r.key} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${color}`} />
              {t(`rec_${r.key}`, r.params ?? {})}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
