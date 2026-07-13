'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, ListChecks, Lock } from 'lucide-react';
import { Button, toast } from '@/components/ui';

interface Criterion { id: string; name: string; max_points: number; sort_order: number; description: string | null }

interface Props {
  periodId: string;
  isTh: boolean;
  periodStatus: string;
  onChange: () => void | Promise<void>;
}

// §G "pick the topics": view / add / remove the criteria (topics) an evaluation scores on. Editable
// only while the period is DRAFT (server-enforced too); once scoring opens the list is locked.
export default function CriteriaEditor({ periodId, isTh, periodStatus, onChange }: Props) {
  const L = isTh
    ? { heading: 'หัวข้อการประเมิน', total: 'คะแนนเต็ม', add: 'เพิ่มหัวข้อ', name: 'ชื่อหัวข้อ', points: 'คะแนน',
        empty: 'ยังไม่มีหัวข้อ', locked: 'ล็อกแล้ว (แก้ได้เฉพาะตอนร่าง)', remove: 'ลบ', pts: 'คะแนน',
        needName: 'กรอกชื่อหัวข้อ', failed: 'ทำรายการไม่สำเร็จ', added: 'เพิ่มแล้ว', removed: 'ลบแล้ว' }
    : { heading: 'Evaluation topics', total: 'Total', add: 'Add topic', name: 'Topic name', points: 'Points',
        empty: 'No topics yet', locked: 'Locked (editable only while draft)', remove: 'Remove', pts: 'pts',
        needName: 'Enter a topic name', failed: 'Action failed', added: 'Added', removed: 'Removed' };

  const [items, setItems] = useState<Criterion[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [points, setPoints] = useState('10');
  const [busy, setBusy] = useState(false);
  const editable = periodStatus === 'draft';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/eval/periods/${periodId}/criteria`);
      setItems((((await res.json()).data ?? []) as Criterion[]));
    } catch {
      /* leave list empty */
    } finally {
      setLoading(false);
    }
  }, [periodId]);

  useEffect(() => { load(); }, [load]);

  const total = items.reduce((s, c) => s + (c.max_points || 0), 0);

  const add = async () => {
    if (!name.trim()) { toast({ type: 'warning', title: L.needName }); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/eval/periods/${periodId}/criteria`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), max_points: Math.max(1, Math.round(Number(points) || 0)), sort_order: items.length }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast({ type: 'error', title: L.failed, message: json?.error }); return; }
      toast({ type: 'success', title: L.added });
      setName(''); setPoints('10');
      await load();
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (criterionId: string) => {
    const res = await fetch(`/api/hr/eval/periods/${periodId}/criteria?criterion_id=${criterionId}`, { method: 'DELETE' });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { toast({ type: 'error', title: L.failed, message: json?.error }); return; }
    toast({ type: 'success', title: L.removed });
    await load();
    await onChange();
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
          <ListChecks className="h-4 w-4" /> {L.heading}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal tabular-nums text-gray-500 dark:bg-gray-700 dark:text-gray-300">
            {L.total} {total}
          </span>
        </div>
        {!editable && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Lock className="h-3 w-3" /> {L.locked}</span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400">{L.empty}</p>
      ) : (
        <ul className="mb-3 divide-y divide-gray-100 dark:divide-gray-700">
          {items.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="text-gray-900 dark:text-white">{c.name}</span>
              <div className="flex items-center gap-2">
                <span className="tabular-nums text-xs text-gray-500 dark:text-gray-400">{c.max_points} {L.pts}</span>
                {editable && (
                  <button onClick={() => remove(c.id)} aria-label={L.remove} title={L.remove}
                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col text-xs text-gray-600 dark:text-gray-400">{L.name}
            <input value={name} onChange={(e) => setName(e.target.value)} className="control mt-1 min-w-[10rem]" />
          </label>
          <label className="flex w-24 flex-col text-xs text-gray-600 dark:text-gray-400">{L.points}
            <input type="number" inputMode="numeric" min={1} value={points} onChange={(e) => setPoints(e.target.value)} className="control mt-1" />
          </label>
          <Button size="sm" type="button" onClick={add} isLoading={busy} icon={<Plus className="h-4 w-4" />}>{L.add}</Button>
        </div>
      )}
    </section>
  );
}
