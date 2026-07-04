'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, Star, CheckCircle2, ClipboardList } from 'lucide-react';
import { Button, Badge, EmptyState, Modal, ModalFooter, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

// §G evaluator self-service: score the people assigned to me for an OPEN period. Data comes from
// self-scoped ESS endpoints (my-periods / my-queue / score) — no HR gate. Anonymity of results is
// enforced elsewhere (my-results); here the evaluator sees the assignees they must score.
interface PeriodItem {
  id: string;
  title: string;
  period_month: string;
  max_score: number;
  total: number;
  done: number;
  pending: number;
}
interface Criterion { id: string; name: string; max_points: number; sort_order: number }
interface QueueItem {
  assignment_id: string;
  employee_id: string;
  employee_name: string;
  status: string;
  scored_criteria: number;
  criteria_count: number;
  complete: boolean;
}
interface SavedScore { criterion_id: string; points: number; comment: string | null }

const numCls =
  'w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
const commentCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

export default function MyEvaluationsPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'ประเมินเพื่อนร่วมงาน', subtitle: 'ให้คะแนนคนที่ได้รับมอบหมายในงวดที่เปิดอยู่', noPeriods: 'ไม่มีงวดที่ต้องประเมินตอนนี้', noQueue: 'ไม่มีคนให้ประเมินในงวดนี้', progress: 'ความคืบหน้า', pending: 'ค้าง', done: 'เสร็จ', score: 'ให้คะแนน', edit: 'แก้ไข', submitted: 'ส่งแล้ว', criterion: 'หัวข้อ', max: 'เต็ม', points: 'คะแนน', comment: 'หมายเหตุ (ถ้ามี)', saveDraft: 'บันทึกร่าง', submit: 'ส่งผลประเมิน', scoring: 'ให้คะแนน', loadFailed: 'โหลดไม่สำเร็จ', saved: 'บันทึกร่างแล้ว', submittedOk: 'ส่งผลประเมินแล้ว', saveFailed: 'บันทึกไม่สำเร็จ', submitConfirm: 'ส่งผลประเมินคนนี้? หลังส่งต้องให้ HR เปิดให้แก้', outOf: 'จาก', close: 'ปิด' }
    : { title: 'Peer evaluation', subtitle: 'Score the people assigned to you in the open period', noPeriods: 'No periods to evaluate right now', noQueue: 'No one to evaluate in this period', progress: 'Progress', pending: 'Pending', done: 'Done', score: 'Score', edit: 'Edit', submitted: 'Submitted', criterion: 'Criterion', max: 'Max', points: 'Points', comment: 'Comment (optional)', saveDraft: 'Save draft', submit: 'Submit', scoring: 'Scoring', loadFailed: 'Load failed', saved: 'Draft saved', submittedOk: 'Evaluation submitted', saveFailed: 'Save failed', submitConfirm: 'Submit this evaluation? HR must reopen it to edit after submitting.', outOf: 'of', close: 'Close' };

  const [periods, setPeriods] = useState<PeriodItem[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(true);
  const [activePeriod, setActivePeriod] = useState<string | null>(null);

  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);

  // scoring modal state
  const [scoringFor, setScoringFor] = useState<QueueItem | null>(null);
  const [form, setForm] = useState<Record<string, { points: string; comment: string }>>({});
  const [modalBusy, setModalBusy] = useState<false | 'draft' | 'submit'>(false);
  const [modalLoading, setModalLoading] = useState(false);

  const loadPeriods = useCallback(async () => {
    setLoadingPeriods(true);
    try {
      const res = await fetch('/api/hr/ess/eval/my-periods');
      const json = await res.json();
      const list = (json.data ?? []) as PeriodItem[];
      setPeriods(list);
      setActivePeriod((cur) => cur ?? (list[0]?.id ?? null));
    } catch {
      toast({ type: 'error', title: L.loadFailed });
    } finally {
      setLoadingPeriods(false);
    }
  }, [L.loadFailed]);

  const loadQueue = useCallback(async (periodId: string) => {
    setLoadingQueue(true);
    try {
      const res = await fetch(`/api/hr/ess/eval/my-queue?period_id=${encodeURIComponent(periodId)}`);
      const json = await res.json();
      setCriteria((json.data?.criteria ?? []) as Criterion[]);
      setQueue((json.data?.items ?? []) as QueueItem[]);
    } catch {
      toast({ type: 'error', title: L.loadFailed });
    } finally {
      setLoadingQueue(false);
    }
  }, [L.loadFailed]);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);
  useEffect(() => { if (activePeriod) loadQueue(activePeriod); }, [activePeriod, loadQueue]);

  const openScoring = async (item: QueueItem) => {
    setScoringFor(item);
    setModalLoading(true);
    // seed empty form for every criterion, then overlay saved values
    const base: Record<string, { points: string; comment: string }> = {};
    for (const c of criteria) base[c.id] = { points: '', comment: '' };
    try {
      const res = await fetch(`/api/hr/ess/eval/score?assignment_id=${encodeURIComponent(item.assignment_id)}`);
      const json = await res.json();
      for (const s of (json.data?.scores ?? []) as SavedScore[]) {
        base[s.criterion_id] = { points: String(s.points), comment: s.comment ?? '' };
      }
    } catch {
      // non-fatal: start from a blank form
    } finally {
      setForm(base);
      setModalLoading(false);
    }
  };

  const closeScoring = () => { setScoringFor(null); setForm({}); };

  const setField = (critId: string, field: 'points' | 'comment', value: string) => {
    setForm((f) => ({ ...f, [critId]: { ...(f[critId] ?? { points: '', comment: '' }), [field]: value } }));
  };

  const buildScores = () =>
    criteria
      .filter((c) => (form[c.id]?.points ?? '') !== '')
      .map((c) => {
        const raw = Number(form[c.id].points);
        const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(raw, c.max_points)) : 0;
        return { criterion_id: c.id, points: clamped, comment: form[c.id]?.comment?.trim() || undefined };
      });

  const allScored = useMemo(
    () => criteria.length > 0 && criteria.every((c) => (form[c.id]?.points ?? '') !== ''),
    [criteria, form],
  );

  const save = async (submit: boolean) => {
    if (!scoringFor) return;
    if (submit && !window.confirm(L.submitConfirm)) return;
    setModalBusy(submit ? 'submit' : 'draft');
    try {
      const res = await fetch('/api/hr/ess/eval/score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assignment_id: scoringFor.assignment_id, scores: buildScores(), submit }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast({ type: 'error', title: (j as { error?: string }).error || L.saveFailed });
        return;
      }
      toast({ type: 'success', title: submit ? L.submittedOk : L.saved });
      if (submit) closeScoring();
      if (activePeriod) await loadQueue(activePeriod);
      await loadPeriods();
    } finally {
      setModalBusy(false);
    }
  };

  const active = periods.find((p) => p.id === activePeriod) ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{L.title}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{L.subtitle}</p>
      </div>

      {loadingPeriods ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : periods.length === 0 ? (
        <EmptyState icon={Star} title={L.noPeriods} />
      ) : (
        <>
          {/* period picker */}
          {periods.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {periods.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePeriod(p.id)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm transition-colors',
                    p.id === activePeriod
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                      : 'border-gray-300 text-gray-600 hover:border-indigo-300 dark:border-gray-600 dark:text-gray-300',
                  )}
                >
                  {p.title} · {p.pending > 0 ? `${p.pending} ${L.pending}` : L.done}
                </button>
              ))}
            </div>
          )}

          {/* progress */}
          {active && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-200">{active.title}</span>
                <span className="tabular-nums text-gray-500 dark:text-gray-400">
                  {active.done}/{active.total} {L.done}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${active.total ? Math.round((active.done / active.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}

          {/* queue */}
          {loadingQueue ? (
            <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : queue.length === 0 ? (
            <EmptyState icon={ClipboardList} title={L.noQueue} />
          ) : (
            <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
              {queue.map((item) => (
                <div key={item.assignment_id} className="flex items-center gap-3 bg-white px-4 py-3 dark:bg-gray-800">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-gray-900 dark:text-white">{item.employee_name}</span>
                      {item.complete && <Badge variant="success">{L.submitted}</Badge>}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {item.scored_criteria}/{item.criteria_count} {L.points.toLowerCase()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={item.complete ? 'ghost' : 'outline'}
                    type="button"
                    icon={item.complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
                    onClick={() => openScoring(item)}
                  >
                    {item.complete ? L.edit : L.score}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* scoring modal */}
      <Modal isOpen={!!scoringFor} onClose={closeScoring} title={scoringFor ? `${L.scoring}: ${scoringFor.employee_name}` : ''} size="lg">
        {modalLoading ? (
          <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-3">
            {criteria.map((c) => (
              <div key={c.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{c.name}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={c.max_points}
                      step="any"
                      value={form[c.id]?.points ?? ''}
                      onChange={(e) => setField(c.id, 'points', e.target.value)}
                      className={numCls}
                    />
                    <span className="whitespace-nowrap text-xs text-gray-400">
                      {L.outOf} {c.max_points}
                    </span>
                  </div>
                </div>
                <input
                  type="text"
                  placeholder={L.comment}
                  value={form[c.id]?.comment ?? ''}
                  onChange={(e) => setField(c.id, 'comment', e.target.value)}
                  className={commentCls}
                />
              </div>
            ))}
          </div>
        )}
        <ModalFooter>
          <Button variant="ghost" type="button" onClick={closeScoring}>{L.close}</Button>
          <Button variant="outline" type="button" isLoading={modalBusy === 'draft'} disabled={modalLoading || modalBusy === 'submit'} onClick={() => save(false)}>{L.saveDraft}</Button>
          <Button type="button" isLoading={modalBusy === 'submit'} disabled={modalLoading || !allScored || modalBusy === 'draft'} onClick={() => save(true)}>{L.submit}</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
