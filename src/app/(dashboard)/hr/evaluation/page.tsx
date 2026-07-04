'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Loader2, Star, Plus, Lock, Play, XCircle } from 'lucide-react';
import { Button, Badge, EmptyState, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

// §G monthly evaluation — periods management (create / list / status transitions). Criteria are
// auto-seeded on create (15-item template); assignment/scoring/results drill-down is a later page.
// Self-contained locale strings to avoid a large i18n block for this admin surface.
interface Period {
  id: string;
  title: string;
  period_month: string; // YYYY-MM-01
  status: 'draft' | 'open' | 'closed' | 'void';
  max_score: number;
  scope_type: string;
}

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function HrEvaluationPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'ประเมินผล (รายเดือน)', subtitle: 'สร้างงวดประเมิน มอบหมายผู้ประเมิน และสรุปผล', create: 'สร้างงวด', titlePh: 'ชื่องวด (เช่น ประเมินเดือนกรกฎาคม)', month: 'เดือน', add: 'สร้าง', empty: 'ยังไม่มีงวดประเมิน', maxScore: 'คะแนนเต็ม', statusDraft: 'ร่าง', statusOpen: 'เปิดให้ประเมิน', statusClosed: 'ปิดแล้ว', statusVoid: 'ยกเลิก', open: 'เปิดให้ประเมิน', close: 'ปิดงวด', void: 'ยกเลิก', loadFailed: 'โหลดไม่สำเร็จ', saveFailed: 'บันทึกไม่สำเร็จ', created: 'สร้างงวดแล้ว', updated: 'อัปเดตแล้ว', invalid: 'กรอกชื่อและเดือน', closeConfirm: 'ปิดงวดนี้? หลังปิดจะคำนวณผลได้', voidConfirm: 'ยกเลิกงวดนี้?' }
    : { title: 'Evaluation (monthly)', subtitle: 'Create periods, assign evaluators, review results', create: 'New period', titlePh: 'Period title (e.g. July review)', month: 'Month', add: 'Create', empty: 'No evaluation periods yet', maxScore: 'Max score', statusDraft: 'Draft', statusOpen: 'Open', statusClosed: 'Closed', statusVoid: 'Void', open: 'Open for scoring', close: 'Close', void: 'Void', loadFailed: 'Load failed', saveFailed: 'Save failed', created: 'Period created', updated: 'Updated', invalid: 'Enter a title and month', closeConfirm: 'Close this period? Results can be computed after closing.', voidConfirm: 'Void this period?' };

  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [month, setMonth] = useState(() => currentMonth());
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/eval/periods');
      const json = await res.json();
      setPeriods((json.data ?? []) as Period[]);
    } catch {
      toast({ type: 'error', title: L.loadFailed });
    } finally {
      setLoading(false);
    }
  }, [L.loadFailed]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!title.trim() || !month) { toast({ type: 'warning', title: L.invalid }); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/hr/eval/periods', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), period_month: `${month}-01` }),
      });
      if (!res.ok) { toast({ type: 'error', title: L.saveFailed }); return; }
      toast({ type: 'success', title: L.created });
      setTitle('');
      await load();
    } finally { setCreating(false); }
  };

  const setStatus = async (id: string, status: Period['status'], confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusyId(id);
    try {
      const res = await fetch('/api/hr/eval/periods', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) { toast({ type: 'error', title: L.saveFailed }); return; }
      toast({ type: 'success', title: L.updated });
      await load();
    } finally { setBusyId(null); }
  };

  const statusBadge = (s: Period['status']) => {
    const map = { draft: { v: 'warning' as const, l: L.statusDraft }, open: { v: 'info' as const, l: L.statusOpen }, closed: { v: 'success' as const, l: L.statusClosed }, void: { v: 'default' as const, l: L.statusVoid } };
    const b = map[s];
    return <Badge variant={b.v}>{b.l}</Badge>;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{L.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{L.subtitle}</p>
        </div>
      </div>

      {/* create form */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{L.create}</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={L.titlePh} className={cn('w-full', inputCls)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{L.month}</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} />
          </div>
          <Button type="button" onClick={create} isLoading={creating} icon={<Plus className="h-4 w-4" />}>{L.add}</Button>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : periods.length === 0 ? (
        <EmptyState icon={Star} title={L.empty} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">{L.month}</th>
                <th className="px-3 py-2">{L.create}</th>
                <th className="px-3 py-2 text-right">{L.maxScore}</th>
                <th className="px-3 py-2 text-center">สถานะ</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {periods.map((p) => (
                <tr key={p.id} className="bg-white dark:bg-gray-800">
                  <td className="px-3 py-2 tabular-nums text-gray-700 dark:text-gray-200">{p.period_month?.slice(0, 7)}</td>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/hr/evaluation/${p.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">{p.title}</Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{p.max_score}</td>
                  <td className="px-3 py-2 text-center">{statusBadge(p.status)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {p.status === 'draft' && (
                        <Button size="sm" variant="outline" type="button" icon={<Play className="h-3.5 w-3.5" />} isLoading={busyId === p.id} onClick={() => setStatus(p.id, 'open')}>{L.open}</Button>
                      )}
                      {p.status === 'open' && (
                        <Button size="sm" variant="outline" type="button" icon={<Lock className="h-3.5 w-3.5" />} isLoading={busyId === p.id} onClick={() => setStatus(p.id, 'closed', L.closeConfirm)}>{L.close}</Button>
                      )}
                      {(p.status === 'draft' || p.status === 'open') && (
                        <Button size="sm" variant="ghost" type="button" icon={<XCircle className="h-3.5 w-3.5" />} isLoading={busyId === p.id} onClick={() => setStatus(p.id, 'void', L.voidConfirm)}>{L.void}</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
