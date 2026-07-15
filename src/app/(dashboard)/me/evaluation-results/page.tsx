'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, Award, TrendingUp, Lightbulb } from 'lucide-react';
import { EmptyState, PageHeader, ScoreRing, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { todayBangkok } from '@/lib/utils/date';

type RingTone = 'good' | 'accent' | 'warn' | 'critical';
function ringTone(pct: number): RingTone {
  return pct >= 80 ? 'good' : pct >= 60 ? 'accent' : pct >= 40 ? 'warn' : 'critical';
}
const BAR_TONE: Record<RingTone, string> = {
  good: 'bg-emerald-500',
  accent: 'bg-indigo-500',
  warn: 'bg-amber-500',
  critical: 'bg-red-500',
};

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 'YYYY-MM-DD' → 'มิ.ย. 69' / 'Jun 26'
function monthYearLabel(periodMonth: string, isTh: boolean): string {
  const y = Number(periodMonth.slice(0, 4));
  const m = Number(periodMonth.slice(5, 7));
  const months = isTh ? TH_MONTHS : EN_MONTHS;
  const yy = String((isTh ? y + 543 : y) % 100).padStart(2, '0');
  return `${months[m - 1] ?? m} ${yy}`;
}

// §G employee self-service: my own monthly evaluation results, visible ONLY after a period closes.
// The per-evaluator breakdown is anonymized (A/B/C…) server-side — this page never receives names.
interface Breakdown { label: string; raw_total: number; score_pct: number | null }
interface CriterionAvg { name: string; max_points: number; avg_points: number | null; pct: number | null }
interface MyResult {
  period_month: string | null;
  title: string;
  score_pct: number | null;
  evaluator_count: number;
  breakdown: Breakdown[];
  criteria: CriterionAvg[];
}

// A criterion this far below perfect (on the latest closed period) counts as "worth improving".
const IMPROVE_BELOW_PCT = 90;

export default function MyEvaluationResultsPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'ผลประเมินของฉัน', subtitle: 'คะแนนประเมินรายเดือน (เห็นได้หลังปิดงวด) · ผู้ประเมินไม่ระบุชื่อ', empty: 'ยังไม่มีผลประเมินที่ปิดงวดแล้ว', evaluators: 'ผู้ประเมิน', loadFailed: 'โหลดไม่สำเร็จ', people: 'คน', overview: 'ภาพรวมปี', yearAvg: 'เฉลี่ยปีนี้', improve: 'เรื่องที่ควรปรับปรุง (งวดล่าสุด)', allGood: 'ทำได้ดีทุกหัวข้อ 🎉', byCriteria: 'คะแนนเฉลี่ยรายหัวข้อ' }
    : { title: 'My evaluation results', subtitle: 'Monthly review scores (visible after a period closes) · evaluators are anonymous', empty: 'No closed evaluation results yet', evaluators: 'Evaluators', loadFailed: 'Load failed', people: '', overview: 'Year overview', yearAvg: 'Year average', improve: 'Areas to improve (latest period)', allGood: 'Strong across the board 🎉', byCriteria: 'Average by criterion' };

  const [results, setResults] = useState<MyResult[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/eval/my-results');
      const json = await res.json();
      setResults((json.data ?? []) as MyResult[]);
    } catch {
      toast({ type: 'error', title: L.loadFailed });
    } finally {
      setLoading(false);
    }
  }, [L.loadFailed]);

  useEffect(() => { load(); }, [load]);

  const currentYear = Number(todayBangkok().slice(0, 4));
  const currentMonthIdx = Number(todayBangkok().slice(5, 7)) - 1;

  // 12-slot strip of this year's score_pct (null = no closed period that month) + yearly average.
  const yearView = useMemo(() => {
    const monthly: (number | null)[] = Array.from({ length: 12 }, () => null);
    for (const r of results) {
      if (!r.period_month || Number(r.period_month.slice(0, 4)) !== currentYear || r.score_pct == null) continue;
      const idx = Number(r.period_month.slice(5, 7)) - 1;
      // Two periods in one month → keep the higher-signal (latest already sorted first, keep first).
      if (idx >= 0 && idx < 12 && monthly[idx] == null) monthly[idx] = Number(r.score_pct);
    }
    const vals = monthly.filter((v): v is number => v != null);
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    return { monthly, avg, count: vals.length };
  }, [results, currentYear]);

  // Weakest criteria from the LATEST closed period (results arrive newest-first).
  const improve = useMemo(() => {
    const latest = results.find((r) => r.criteria?.some((c) => c.pct != null));
    if (!latest) return null;
    const ranked = latest.criteria
      .filter((c) => c.pct != null)
      .sort((a, b) => (a.pct as number) - (b.pct as number));
    return { period: latest.period_month, items: ranked.filter((c) => (c.pct as number) < IMPROVE_BELOW_PCT).slice(0, 2) };
  }, [results]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <PageHeader title={L.title} subtitle={L.subtitle} />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : results.length === 0 ? (
        <EmptyState icon={Award} title={L.empty} />
      ) : (
        <div className="space-y-3">
          {/* Year overview: monthly averages + areas to improve */}
          {yearView.count > 0 && (
            <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center justify-between">
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                  <TrendingUp className="h-4 w-4 text-indigo-500" />
                  {L.overview} {isTh ? currentYear + 543 : currentYear}
                </p>
                {yearView.avg != null && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {L.yearAvg}{' '}
                    <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">{yearView.avg.toFixed(1)}%</span>
                  </p>
                )}
              </div>

              <div className="grid grid-cols-12 gap-1">
                {(isTh ? TH_MONTHS : EN_MONTHS).map((m, i) => {
                  const v = yearView.monthly[i];
                  const isCurrent = i === currentMonthIdx;
                  return (
                    <div key={m} className="flex flex-col items-center gap-0.5">
                      <div className="flex h-14 w-full items-end">
                        <div
                          className={cn('w-full rounded-sm', v != null ? BAR_TONE[ringTone(v)] : 'bg-gray-100 dark:bg-gray-700')}
                          style={{ height: v != null ? `${Math.max(8, v)}%` : '4px' }}
                          title={v != null ? `${v.toFixed(1)}%` : undefined}
                        />
                      </div>
                      <span className={cn('text-[9px]', isCurrent ? 'font-semibold text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-500')}>{m}</span>
                      <span className="h-3 text-[9px] tabular-nums text-gray-500 dark:text-gray-400">{v != null ? Math.round(v) : ''}</span>
                    </div>
                  );
                })}
              </div>

              {improve && (
                <div className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-900/15">
                  <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    <Lightbulb className="h-3.5 w-3.5" />
                    {L.improve}
                  </p>
                  {improve.items.length === 0 ? (
                    <p className="mt-0.5 text-xs text-amber-700/90 dark:text-amber-200/90">{L.allGood}</p>
                  ) : (
                    <ul className="mt-0.5 space-y-0.5 text-xs text-amber-800 dark:text-amber-200">
                      {improve.items.map((c) => (
                        <li key={c.name} className="tabular-nums">
                          • {c.name} — {c.avg_points}/{c.max_points} ({(c.pct as number).toFixed(0)}%)
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {results.map((r, i) => (
            <div key={`${r.period_month}-${i}`} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center gap-4">
                <ScoreRing
                  pct={r.score_pct ?? 0}
                  size={72}
                  strokeWidth={7}
                  tone={ringTone(r.score_pct ?? 0)}
                  label={r.score_pct == null ? '—' : String(Math.round(r.score_pct))}
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 dark:text-white">{r.title || (r.period_month ? monthYearLabel(r.period_month, isTh) : '')}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {r.period_month ? monthYearLabel(r.period_month, isTh) : '—'} · {L.evaluators}: {r.evaluator_count}{isTh ? ` ${L.people}` : ''}
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-gray-900 dark:text-white">
                    {r.score_pct == null ? '—' : `${Number(r.score_pct).toFixed(1)}%`}
                  </p>
                </div>
              </div>

              {/* Average across evaluators, per criterion */}
              {r.criteria?.some((c) => c.pct != null) && (
                <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-3 dark:border-gray-700">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{L.byCriteria}</p>
                  {r.criteria.map((c) => (
                    <div key={c.name} className="flex items-center gap-2 text-xs">
                      <span className="w-32 shrink-0 truncate text-gray-600 dark:text-gray-300">{c.name}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                        <div
                          className={cn('h-full rounded-full', c.pct != null ? BAR_TONE[ringTone(c.pct)] : 'bg-gray-200')}
                          style={{ width: `${Math.max(0, Math.min(100, c.pct ?? 0))}%` }}
                        />
                      </div>
                      <span className="w-20 shrink-0 text-right tabular-nums text-gray-700 dark:text-gray-200">
                        {c.avg_points == null ? '—' : `${c.avg_points}/${c.max_points}`}
                        {c.pct != null && <span className="text-gray-400"> · {c.pct.toFixed(0)}%</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {r.breakdown.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
                  {r.breakdown.map((b) => (
                    <div key={b.label} className="flex items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1 text-xs dark:bg-gray-700/50">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{b.label}</span>
                      <span className="tabular-nums text-gray-700 dark:text-gray-200">{b.score_pct == null ? '—' : `${Number(b.score_pct).toFixed(0)}%`}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
