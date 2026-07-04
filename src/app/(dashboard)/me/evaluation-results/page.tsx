'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, Award } from 'lucide-react';
import { EmptyState, PageHeader, ScoreRing, toast } from '@/components/ui';

type RingTone = 'good' | 'accent' | 'warn' | 'critical';
function ringTone(pct: number): RingTone {
  return pct >= 80 ? 'good' : pct >= 60 ? 'accent' : pct >= 40 ? 'warn' : 'critical';
}

// §G employee self-service: my own monthly evaluation results, visible ONLY after a period closes.
// The per-evaluator breakdown is anonymized (A/B/C…) server-side — this page never receives names.
interface Breakdown { label: string; raw_total: number; score_pct: number | null }
interface MyResult {
  period_month: string | null;
  title: string;
  score_pct: number | null;
  evaluator_count: number;
  breakdown: Breakdown[];
}

export default function MyEvaluationResultsPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'ผลประเมินของฉัน', subtitle: 'คะแนนประเมินรายเดือน (เห็นได้หลังปิดงวด) · ผู้ประเมินไม่ระบุชื่อ', empty: 'ยังไม่มีผลประเมินที่ปิดงวดแล้ว', evaluators: 'ผู้ประเมิน', reviewer: 'ผู้ประเมิน', score: 'คะแนน', loadFailed: 'โหลดไม่สำเร็จ', people: 'คน' }
    : { title: 'My evaluation results', subtitle: 'Monthly review scores (visible after a period closes) · evaluators are anonymous', empty: 'No closed evaluation results yet', evaluators: 'Evaluators', reviewer: 'Reviewer', score: 'Score', loadFailed: 'Load failed', people: '' };

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

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <PageHeader title={L.title} subtitle={L.subtitle} />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : results.length === 0 ? (
        <EmptyState icon={Award} title={L.empty} />
      ) : (
        <div className="space-y-3">
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
                  <p className="font-medium text-gray-900 dark:text-white">{r.title || r.period_month?.slice(0, 7)}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {r.period_month?.slice(0, 7)} · {L.evaluators}: {r.evaluator_count}{isTh ? ` ${L.people}` : ''}
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-gray-900 dark:text-white">
                    {r.score_pct == null ? '—' : `${Number(r.score_pct).toFixed(1)}%`}
                  </p>
                </div>
              </div>

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
