'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Loader2, Plus, Trash2, ArrowLeft, Calculator } from 'lucide-react';
import { Button, Badge, EmptyState, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

// §G evaluation — period detail: manage evaluator↔employee assignments, compute results after
// scoring, and review per-employee scores. Self-contained locale strings.
interface Profile { id: string; display_name: string | null; username: string | null }
interface Assignment { id: string; evaluator_id: string; employee_id: string; status: string; evaluator: Profile | null; employee: Profile | null }
interface Period { id: string; title: string; period_month: string; status: string; max_score: number }
interface Result { id: string; employee_id: string; evaluator_count: number; score_pct: number | null; name?: string }
interface EmployeeOpt { id: string; name: string }

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
const nameOf = (p: Profile | null) => p?.display_name || p?.username || '—';

export default function EvalPeriodDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { back: 'กลับ', assignments: 'มอบหมายผู้ประเมิน', evaluator: 'ผู้ประเมิน', employee: 'ผู้ถูกประเมิน', add: 'เพิ่ม', noAssignments: 'ยังไม่มีการมอบหมาย', remove: 'ลบ', compute: 'คำนวณผล', results: 'ผลประเมิน', noResults: 'ยังไม่มีผล (คำนวณหลังปิดงวด)', colEmployee: 'พนักงาน', colEvaluators: 'จำนวนผู้ประเมิน', colScore: 'คะแนน (%)', submitted: 'ส่งแล้ว', assigned: 'รอประเมิน', loadFailed: 'โหลดไม่สำเร็จ', saveFailed: 'บันทึกไม่สำเร็จ', added: 'เพิ่มแล้ว', removed: 'ลบแล้ว', computed: 'คำนวณผลแล้ว', pickBoth: 'เลือกผู้ประเมินและผู้ถูกประเมิน', notFound: 'ไม่พบงวด', payoutRule: 'สูตรจ่ายโบนัส (เชิงเส้น)', flat: 'ฐาน (บาท)', perPct: 'ต่อ 1% (บาท)', saveRule: 'บันทึกสูตร', computePayouts: 'คำนวณเงิน', ruleSaved: 'บันทึกสูตรแล้ว', payoutsComputed: 'คำนวณเงินแล้ว', payoutHint: 'จ่าย = ฐาน + (ต่อ 1% × คะแนน%) · ติดลบ = หักจาก SC' }
    : { back: 'Back', assignments: 'Evaluator assignments', evaluator: 'Evaluator', employee: 'Employee', add: 'Add', noAssignments: 'No assignments yet', remove: 'Remove', compute: 'Compute results', results: 'Results', noResults: 'No results yet (compute after closing)', colEmployee: 'Employee', colEvaluators: 'Evaluators', colScore: 'Score (%)', submitted: 'Submitted', assigned: 'Pending', loadFailed: 'Load failed', saveFailed: 'Save failed', added: 'Added', removed: 'Removed', computed: 'Results computed', pickBoth: 'Pick an evaluator and an employee', notFound: 'Period not found', payoutRule: 'Payout formula (linear)', flat: 'Flat (THB)', perPct: 'Per 1% (THB)', saveRule: 'Save formula', computePayouts: 'Compute payouts', ruleSaved: 'Formula saved', payoutsComputed: 'Payouts computed', payoutHint: 'Payout = flat + (per-1% × score%) · negative = SC deduction' };

  const [period, setPeriod] = useState<Period | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluatorId, setEvaluatorId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [adding, setAdding] = useState(false);
  const [computing, setComputing] = useState(false);
  const [flatBaht, setFlatBaht] = useState('');
  const [perPctBaht, setPerPctBaht] = useState('');
  const [savingRule, setSavingRule] = useState(false);
  const [computingPayouts, setComputingPayouts] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, aRes, rRes, eRes, ruleRes] = await Promise.all([
        fetch('/api/hr/eval/periods'),
        fetch(`/api/hr/eval/periods/${id}/assignments`),
        fetch(`/api/hr/eval/periods/${id}/results`),
        fetch('/api/hr/employees'),
        fetch(`/api/hr/eval/periods/${id}/payout-rule`),
      ]);
      const pJson = await pRes.json();
      setPeriod(((pJson.data ?? []) as Period[]).find((p) => p.id === id) ?? null);
      setAssignments(((await aRes.json()).data ?? []) as Assignment[]);
      setResults(((await rRes.json()).data ?? []) as Result[]);
      const emps = ((await eRes.json()).data ?? []) as { profile_id: string; profile: Profile | null }[];
      setEmployees(emps.map((e) => ({ id: e.profile_id, name: nameOf(e.profile) })));
      const rule = ((await ruleRes.json()).data as { rule?: { flat_satang: number; satang_per_pct: number } } | null)?.rule;
      setFlatBaht(rule ? String(rule.flat_satang / 100) : '');
      setPerPctBaht(rule ? String(rule.satang_per_pct / 100) : '');
    } catch {
      toast({ type: 'error', title: L.loadFailed });
    } finally {
      setLoading(false);
    }
  }, [id, L.loadFailed]);

  useEffect(() => { load(); }, [load]);

  const addAssignment = async () => {
    if (!evaluatorId || !employeeId) { toast({ type: 'warning', title: L.pickBoth }); return; }
    setAdding(true);
    try {
      const res = await fetch(`/api/hr/eval/periods/${id}/assignments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evaluator_id: evaluatorId, employee_id: employeeId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast({ type: 'error', title: L.saveFailed, message: json?.error }); return; }
      toast({ type: 'success', title: L.added });
      setEvaluatorId(''); setEmployeeId('');
      await load();
    } finally { setAdding(false); }
  };

  const removeAssignment = async (assignmentId: string) => {
    const res = await fetch(`/api/hr/eval/periods/${id}/assignments?assignment_id=${assignmentId}`, { method: 'DELETE' });
    if (!res.ok) { toast({ type: 'error', title: L.saveFailed }); return; }
    toast({ type: 'success', title: L.removed });
    await load();
  };

  const compute = async () => {
    setComputing(true);
    try {
      const res = await fetch(`/api/hr/eval/periods/${id}/compute`, { method: 'POST' });
      if (!res.ok) { toast({ type: 'error', title: L.saveFailed }); return; }
      toast({ type: 'success', title: L.computed });
      await load();
    } finally { setComputing(false); }
  };

  const saveRule = async () => {
    setSavingRule(true);
    try {
      const res = await fetch(`/api/hr/eval/periods/${id}/payout-rule`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ formula_type: 'linear', flat_satang: Math.round((Number(flatBaht) || 0) * 100), satang_per_pct: Math.round((Number(perPctBaht) || 0) * 100) }),
      });
      if (!res.ok) { toast({ type: 'error', title: L.saveFailed }); return; }
      toast({ type: 'success', title: L.ruleSaved });
    } finally { setSavingRule(false); }
  };

  const computePayouts = async () => {
    setComputingPayouts(true);
    try {
      const res = await fetch(`/api/hr/eval/periods/${id}/payouts`, { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast({ type: 'error', title: L.saveFailed, message: json?.error }); return; }
      toast({ type: 'success', title: L.payoutsComputed });
    } finally { setComputingPayouts(false); }
  };

  const nameById = (pid: string) => employees.find((e) => e.id === pid)?.name || pid.slice(0, 8);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Link href="/hr/evaluation" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600 dark:text-gray-400">
        <ArrowLeft className="h-4 w-4" /> {L.back}
      </Link>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !period ? (
        <EmptyState icon={Calculator} title={L.notFound} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{period.title}</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">{period.period_month?.slice(0, 7)} · {period.max_score} pts</p>
            </div>
            <Badge variant={period.status === 'open' ? 'info' : period.status === 'closed' ? 'success' : period.status === 'void' ? 'default' : 'warning'}>{period.status}</Badge>
          </div>

          {/* assignments */}
          <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-white">{L.assignments}</h2>
            {assignments.length === 0 ? (
              <p className="text-sm text-gray-400">{L.noAssignments}</p>
            ) : (
              <ul className="mb-3 divide-y divide-gray-100 dark:divide-gray-700">
                {assignments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-gray-900 dark:text-white">
                      {nameOf(a.evaluator)} <span className="text-gray-400">→</span> {nameOf(a.employee)}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant={a.status === 'submitted' ? 'success' : 'warning'} size="sm">{a.status === 'submitted' ? L.submitted : L.assigned}</Badge>
                      <button onClick={() => removeAssignment(a.id)} aria-label={L.remove} title={L.remove} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.evaluator}
                <select value={evaluatorId} onChange={(e) => setEvaluatorId(e.target.value)} className={cn('mt-1 w-44', inputCls)}>
                  <option value="">—</option>
                  {employees.map((e) => (<option key={e.id} value={e.id}>{e.name}</option>))}
                </select>
              </label>
              <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.employee}
                <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={cn('mt-1 w-44', inputCls)}>
                  <option value="">—</option>
                  {employees.map((e) => (<option key={e.id} value={e.id}>{e.name}</option>))}
                </select>
              </label>
              <Button size="sm" type="button" onClick={addAssignment} isLoading={adding} icon={<Plus className="h-4 w-4" />}>{L.add}</Button>
            </div>
          </section>

          {/* results */}
          <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">{L.results}</h2>
              <Button size="sm" variant="outline" type="button" onClick={compute} isLoading={computing} icon={<Calculator className="h-4 w-4" />}>{L.compute}</Button>
            </div>
            {results.length === 0 ? (
              <p className="text-sm text-gray-400">{L.noResults}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full min-w-[28rem] text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2">{L.colEmployee}</th>
                      <th className="px-3 py-2 text-right">{L.colEvaluators}</th>
                      <th className="px-3 py-2 text-right">{L.colScore}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {results.map((r) => (
                      <tr key={r.id} className="bg-white dark:bg-gray-800">
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{r.name || nameById(r.employee_id)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{r.evaluator_count}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900 dark:text-white">{r.score_pct == null ? '—' : `${Number(r.score_pct).toFixed(1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* payout rule (linear) */}
          <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{L.payoutRule}</h2>
            <p className="mb-3 text-xs text-gray-400">{L.payoutHint}</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.flat}
                <input type="number" inputMode="decimal" step={0.01} value={flatBaht} onChange={(e) => setFlatBaht(e.target.value)} placeholder="0.00" className={cn('mt-1 w-32', inputCls)} />
              </label>
              <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.perPct}
                <input type="number" inputMode="decimal" step={0.01} value={perPctBaht} onChange={(e) => setPerPctBaht(e.target.value)} placeholder="0.00" className={cn('mt-1 w-32', inputCls)} />
              </label>
              <Button size="sm" type="button" onClick={saveRule} isLoading={savingRule}>{L.saveRule}</Button>
              <Button size="sm" variant="outline" type="button" onClick={computePayouts} isLoading={computingPayouts}>{L.computePayouts}</Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
