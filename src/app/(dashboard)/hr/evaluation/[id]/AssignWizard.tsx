'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Users, Save, Trash2 } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { employeeNameLabel } from '@/lib/hr/employee-name';

interface StoreOpt { id: string; store_name: string }
interface PositionOpt { id: string; name: string }
interface PersonOpt { id: string; name: string; position: string | null }
interface TemplateOpt { id: string; name: string; pair_count: number }

interface Props {
  periodId: string;
  isTh: boolean;
  onDone: () => void | Promise<void>;
}

interface EmployeeApiRow {
  profile_id: string;
  full_name: string | null;
  profile: { display_name: string | null; username: string | null } | null;
  position: { name: string | null } | null;
}

// §Phase 4 per-branch assignment: pick STORE → a group of EVALUATEES (position-filtered) → a group
// of EVALUATORS (position-filtered) → assign the whole matrix at once (batch endpoint notifies each
// evaluator once). Replaces the old one-evaluator-one-evaluatee-at-a-time dropdowns.
export default function AssignWizard({ periodId, isTh, onDone }: Props) {
  const L = isTh
    ? { heading: 'มอบหมายผู้ประเมิน (ต่อสาขา)', store: 'สาขา', pickStore: '— เลือกสาขา —', allPos: 'ทุกตำแหน่ง',
        evaluatees: 'ผู้ถูกประเมิน', evaluators: 'ผู้ประเมิน', filterPos: 'ตำแหน่ง', selectAll: 'เลือกทั้งหมด', clear: 'ล้าง',
        selected: 'เลือกแล้ว', none: 'ไม่มีพนักงานตามตัวกรอง', pickStoreFirst: 'เลือกสาขาก่อน',
        assign: 'มอบหมาย', pairs: 'คู่', assigned: 'มอบหมายแล้ว', skipped: 'ข้าม (ซ้ำ)', pickBoth: 'เลือกผู้ประเมินและผู้ถูกประเมินอย่างน้อยกลุ่มละ 1 คน', failed: 'ทำรายการไม่สำเร็จ',
        tpl: 'เทมเพลทสาขานี้', useTpl: 'ใช้เทมเพลท', pickTpl: '— เลือกเทมเพลท —', noTpl: 'ยังไม่มีเทมเพลท', saveTpl: 'บันทึกเป็นเทมเพลท', tplNamePh: 'ตั้งชื่อเทมเพลท', tplSaved: 'บันทึกเทมเพลทแล้ว', tplApplied: 'ดึงเทมเพลทมาใช้แล้ว', tplNameNeeded: 'ตั้งชื่อเทมเพลทก่อน', delTpl: 'ลบเทมเพลท', pairsForTpl: 'เลือกผู้ประเมิน+ผู้ถูกประเมินก่อนบันทึกเทมเพลท' }
    : { heading: 'Assign evaluators (per branch)', store: 'Branch', pickStore: '— pick a branch —', allPos: 'All positions',
        evaluatees: 'Evaluatees', evaluators: 'Evaluators', filterPos: 'Position', selectAll: 'Select all', clear: 'Clear',
        selected: 'selected', none: 'No staff match the filter', pickStoreFirst: 'Pick a branch first',
        assign: 'Assign', pairs: 'pairs', assigned: 'Assigned', skipped: 'skipped (duplicates)', pickBoth: 'Pick at least one evaluator and one evaluatee', failed: 'Action failed',
        tpl: 'Branch templates', useTpl: 'Apply template', pickTpl: '— pick a template —', noTpl: 'No templates yet', saveTpl: 'Save as template', tplNamePh: 'Template name', tplSaved: 'Template saved', tplApplied: 'Template applied', tplNameNeeded: 'Name the template first', delTpl: 'Delete template', pairsForTpl: 'Select evaluators + evaluatees before saving a template' };

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [positions, setPositions] = useState<PositionOpt[]>([]);
  const [storeId, setStoreId] = useState('');

  const [teePos, setTeePos] = useState('');
  const [torPos, setTorPos] = useState('');
  const [evaluatees, setEvaluatees] = useState<PersonOpt[]>([]);
  const [evaluators, setEvaluators] = useState<PersonOpt[]>([]);
  const [selTees, setSelTees] = useState<Set<string>>(new Set());
  const [selTors, setSelTors] = useState<Set<string>>(new Set());
  const [loadingTees, setLoadingTees] = useState(false);
  const [loadingTors, setLoadingTors] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [tplId, setTplId] = useState('');
  const [tplName, setTplName] = useState('');
  const [tplBusy, setTplBusy] = useState(false);

  // Reference data: manageable stores + positions.
  useEffect(() => {
    (async () => {
      try {
        const [sRes, pRes] = await Promise.all([
          fetch('/api/hr/manageable-stores'),
          fetch('/api/hr/positions'),
        ]);
        setStores((((await sRes.json()).data ?? []) as StoreOpt[]));
        setPositions((((await pRes.json()).data ?? []) as PositionOpt[]));
      } catch {
        /* selects simply stay empty */
      }
    })();
  }, []);

  const fetchPeople = useCallback(
    async (positionId: string): Promise<PersonOpt[]> => {
      const qs = new URLSearchParams({ store_id: storeId, status: 'active', limit: '200' });
      if (positionId) qs.set('position_id', positionId);
      const res = await fetch(`/api/hr/employees?${qs.toString()}`);
      if (!res.ok) return [];
      const rows = ((await res.json()).data ?? []) as EmployeeApiRow[];
      return rows.map((r) => ({
        id: r.profile_id,
        // full_name was last in this chain, so it never won — every picker showed the ชื่อเล่น.
        name: employeeNameLabel({
          full_name: r.full_name,
          display_name: r.profile?.display_name,
          username: r.profile?.username,
        }),
        position: r.position?.name ?? null,
      }));
    },
    [storeId]
  );

  // (Re)load each side when the store or that side's position filter changes. Selections that fall
  // out of the new list are pruned so a hidden pick can't be submitted.
  useEffect(() => {
    if (!storeId) { setEvaluatees([]); setSelTees(new Set()); return; }
    let alive = true;
    setLoadingTees(true);
    fetchPeople(teePos)
      .then((list) => {
        if (!alive) return;
        setEvaluatees(list);
        const ids = new Set(list.map((p) => p.id));
        setSelTees((prev) => new Set([...prev].filter((x) => ids.has(x))));
      })
      .finally(() => alive && setLoadingTees(false));
    return () => { alive = false; };
  }, [storeId, teePos, fetchPeople]);

  useEffect(() => {
    if (!storeId) { setEvaluators([]); setSelTors(new Set()); return; }
    let alive = true;
    setLoadingTors(true);
    fetchPeople(torPos)
      .then((list) => {
        if (!alive) return;
        setEvaluators(list);
        const ids = new Set(list.map((p) => p.id));
        setSelTors((prev) => new Set([...prev].filter((x) => ids.has(x))));
      })
      .finally(() => alive && setLoadingTors(false));
    return () => { alive = false; };
  }, [storeId, torPos, fetchPeople]);

  // Saved templates for the selected store.
  const loadTemplates = useCallback(async () => {
    if (!storeId) { setTemplates([]); setTplId(''); return; }
    try {
      const res = await fetch(`/api/hr/eval/templates?store_id=${storeId}`);
      const list = res.ok ? (((await res.json()).data ?? []) as TemplateOpt[]) : [];
      setTemplates(list);
      setTplId((prev) => (list.some((t) => t.id === prev) ? prev : ''));
    } catch {
      setTemplates([]);
    }
  }, [storeId]);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const pairCount = useMemo(() => {
    let n = 0;
    for (const tor of selTors) for (const tee of selTees) if (tor !== tee) n++;
    return n;
  }, [selTors, selTees]);

  // The current selection as explicit pairs (for saving a template).
  const selectedPairs = useMemo(() => {
    const out: { evaluator_id: string; employee_id: string }[] = [];
    for (const tor of selTors) for (const tee of selTees) if (tor !== tee) out.push({ evaluator_id: tor, employee_id: tee });
    return out;
  }, [selTors, selTees]);

  const saveTemplate = async () => {
    if (!tplName.trim()) { toast({ type: 'warning', title: L.tplNameNeeded }); return; }
    if (selectedPairs.length === 0) { toast({ type: 'warning', title: L.pairsForTpl }); return; }
    setTplBusy(true);
    try {
      const res = await fetch('/api/hr/eval/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, name: tplName.trim(), pairs: selectedPairs }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast({ type: 'error', title: L.failed, message: json?.error }); return; }
      toast({ type: 'success', title: L.tplSaved });
      setTplName('');
      await loadTemplates();
    } finally {
      setTplBusy(false);
    }
  };

  const applyTemplate = async () => {
    if (!tplId) return;
    setTplBusy(true);
    try {
      const res = await fetch(`/api/hr/eval/periods/${periodId}/assignments/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ template_id: tplId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; data?: { created: number; skipped: number } };
      if (!res.ok) { toast({ type: 'error', title: L.failed, message: json?.error }); return; }
      toast({ type: 'success', title: `${L.tplApplied}: ${json.data?.created ?? 0}`, message: json.data?.skipped ? `${L.skipped}: ${json.data.skipped}` : undefined });
      await onDone();
    } finally {
      setTplBusy(false);
    }
  };

  const deleteTemplate = async () => {
    if (!tplId) return;
    setTplBusy(true);
    try {
      const res = await fetch(`/api/hr/eval/templates/${tplId}`, { method: 'DELETE' });
      if (res.ok) await loadTemplates();
    } finally {
      setTplBusy(false);
    }
  };

  const submit = async () => {
    if (selTees.size === 0 || selTors.size === 0) { toast({ type: 'warning', title: L.pickBoth }); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/hr/eval/periods/${periodId}/assignments/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, evaluator_ids: [...selTors], employee_ids: [...selTees] }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; data?: { created: number; skipped: number } };
      if (!res.ok) { toast({ type: 'error', title: L.failed, message: json?.error }); return; }
      toast({ type: 'success', title: `${L.assigned}: ${json.data?.created ?? 0}`, message: json.data?.skipped ? `${L.skipped}: ${json.data.skipped}` : undefined });
      setSelTees(new Set());
      setSelTors(new Set());
      await onDone();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900/50 dark:bg-indigo-900/10">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-indigo-900 dark:text-indigo-200">
        <Users className="h-4 w-4" /> {L.heading}
      </div>

      <label className="mb-3 flex max-w-xs flex-col text-xs text-gray-600 dark:text-gray-400">
        {L.store}
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="control mt-1">
          <option value="">{L.pickStore}</option>
          {stores.map((s) => (<option key={s.id} value={s.id}>{s.store_name}</option>))}
        </select>
      </label>

      {!storeId ? (
        <p className="py-6 text-center text-sm text-gray-400">{L.pickStoreFirst}</p>
      ) : (
        <>
          {/* reusable per-store templates: apply a saved matrix, or save the current selection */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white/70 p-2 text-xs dark:border-gray-700 dark:bg-gray-800/50">
            <span className="font-semibold text-gray-600 dark:text-gray-300">{L.tpl}:</span>
            <select value={tplId} onChange={(e) => setTplId(e.target.value)} className="control h-8 py-0 text-xs" disabled={templates.length === 0}>
              <option value="">{templates.length === 0 ? L.noTpl : L.pickTpl}</option>
              {templates.map((tp) => (<option key={tp.id} value={tp.id}>{tp.name} ({tp.pair_count})</option>))}
            </select>
            <Button size="sm" variant="outline" type="button" onClick={applyTemplate} isLoading={tplBusy} disabled={!tplId}>{L.useTpl}</Button>
            {tplId && (
              <button type="button" onClick={deleteTemplate} aria-label={L.delTpl} title={L.delTpl}
                className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-600" />
            <input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder={L.tplNamePh}
              className="control h-8 w-40 py-0 text-xs" />
            <Button size="sm" variant="outline" type="button" onClick={saveTemplate} isLoading={tplBusy}
              disabled={selectedPairs.length === 0} icon={<Save className="h-3.5 w-3.5" />}>{L.saveTpl}</Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <PickColumn label={L.evaluatees} people={evaluatees} loading={loadingTees} selected={selTees} setSelected={setSelTees}
              posId={teePos} setPosId={setTeePos} positions={positions} L={L} />
            <PickColumn label={L.evaluators} people={evaluators} loading={loadingTors} selected={selTors} setSelected={setSelTors}
              posId={torPos} setPosId={setTorPos} positions={positions} L={L} />
          </div>

          <div className="mt-3 flex items-center justify-end gap-3">
            <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
              {selTors.size} × {selTees.size} = {pairCount} {L.pairs}
            </span>
            <Button size="sm" type="button" onClick={submit} isLoading={submitting} disabled={pairCount === 0}>
              {L.assign}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface ColLabels { filterPos: string; allPos: string; selectAll: string; clear: string; selected: string; none: string }

// One side (evaluatees or evaluators): a position filter + a scrollable multi-select checkbox list.
function PickColumn({
  label, people, loading, selected, setSelected, posId, setPosId, positions, L,
}: {
  label: string;
  people: PersonOpt[];
  loading: boolean;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  posId: string;
  setPosId: (v: string) => void;
  positions: PositionOpt[];
  L: ColLabels;
}) {
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const allShown = people.length > 0 && people.every((p) => selected.has(p.id));

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-700">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
          {label} <span className="font-normal text-gray-400">({selected.size} {L.selected})</span>
        </span>
        <select value={posId} onChange={(e) => setPosId(e.target.value)} className="control h-7 py-0 text-xs">
          <option value="">{L.allPos}</option>
          {positions.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
      </div>
      <div className="flex items-center gap-3 px-3 py-1.5 text-[11px]">
        <button type="button" className="text-indigo-600 hover:underline disabled:text-gray-300 dark:text-indigo-400"
          disabled={people.length === 0}
          onClick={() => setSelected(allShown ? new Set() : new Set(people.map((p) => p.id)))}>
          {allShown ? L.clear : L.selectAll}
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto px-1 pb-2">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : people.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-400">{L.none}</p>
        ) : (
          people.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
              <span className="text-gray-900 dark:text-white">{p.name}</span>
              {p.position && <span className="text-[10px] text-gray-400">· {p.position}</span>}
            </label>
          ))
        )}
      </div>
    </div>
  );
}
