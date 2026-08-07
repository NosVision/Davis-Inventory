'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Loader2, Trash2, ArrowLeft, Calculator } from 'lucide-react';
import { Button, EmptyState, PageHeader, SectionHeading, StatusBadge, type StatusTone, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import AssignWizard from './AssignWizard';
import CriteriaEditor from './CriteriaEditor';
import { employeeNameLabel } from '@/lib/hr/employee-name';

// §G evaluation — period detail: manage evaluator↔employee assignments, compute results after
// scoring, and review per-employee scores. Self-contained locale strings.
interface Profile { id: string; full_name?: string | null; display_name: string | null; username: string | null }
interface Assignment { id: string; evaluator_id: string; employee_id: string; status: string; evaluator: Profile | null; employee: Profile | null }
interface Period { id: string; title: string; period_month: string; status: string; max_score: number }
interface Result { id: string; employee_id: string; evaluator_count: number; score_pct: number | null; name?: string }
interface Payout { id: string; amount_satang: number; status: string; input_pct_score: number | null; result: { employee_id: string; score_pct: number | null } | null }
interface EmployeeOpt { id: string; name: string }

const nameOf = (p: Profile | null) => employeeNameLabel(p);

export default function EvalPeriodDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { back: 'กลับ', assignments: 'มอบหมายผู้ประเมิน', evaluator: 'ผู้ประเมิน', employee: 'ผู้ถูกประเมิน', add: 'เพิ่ม', noAssignments: 'ยังไม่มีการมอบหมาย', remove: 'ลบ', compute: 'คำนวณผล', results: 'ผลประเมิน', noResults: 'ยังไม่มีผล (คำนวณหลังปิดงวด)', colEmployee: 'พนักงาน', colEvaluators: 'จำนวนผู้ประเมิน', colScore: 'คะแนน (%)', submitted: 'ส่งแล้ว', assigned: 'รอประเมิน', loadFailed: 'โหลดไม่สำเร็จ', saveFailed: 'บันทึกไม่สำเร็จ', added: 'เพิ่มแล้ว', removed: 'ลบแล้ว', computed: 'คำนวณผลแล้ว', pickBoth: 'เลือกผู้ประเมินและผู้ถูกประเมิน', notFound: 'ไม่พบงวด', payoutRule: 'สูตรจ่ายโบนัส (เชิงเส้น)', flat: 'ฐาน (บาท)', perPct: 'ต่อ 1% (บาท)', saveRule: 'บันทึกสูตร', computePayouts: 'คำนวณเงิน', ruleSaved: 'บันทึกสูตรแล้ว', payoutsComputed: 'คำนวณเงินแล้ว', payoutHint: 'จ่าย = ฐาน + (ต่อ 1% × คะแนน%) · ติดลบ = หักจาก SC', payouts: 'รายการจ่าย/หัก', noPayouts: 'ยังไม่มีรายการ (กดคำนวณเงิน)', colAmount: 'จำนวน (บาท)', colStatus: 'สถานะ', approve: 'อนุมัติ', reject: 'ปฏิเสธ', approveAll: 'อนุมัติทั้งหมด', applySc: 'ลงหัก SC', poDraft: 'ร่าง', poApproved: 'อนุมัติแล้ว', poVoid: 'ยกเลิก', poApplied: 'ลงบัญชีแล้ว', poSuperseded: 'ถูกแทนที่', bonus: 'โบนัส', deduction: 'หัก', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธแล้ว', applied: 'ลงหัก SC แล้ว', applyResult: 'ลงหัก', colWorkIndex: 'ดัชนีเวลา' }
    : { back: 'Back', assignments: 'Evaluator assignments', evaluator: 'Evaluator', employee: 'Employee', add: 'Add', noAssignments: 'No assignments yet', remove: 'Remove', compute: 'Compute results', results: 'Results', noResults: 'No results yet (compute after closing)', colEmployee: 'Employee', colEvaluators: 'Evaluators', colScore: 'Score (%)', submitted: 'Submitted', assigned: 'Pending', loadFailed: 'Load failed', saveFailed: 'Save failed', added: 'Added', removed: 'Removed', computed: 'Results computed', pickBoth: 'Pick an evaluator and an employee', notFound: 'Period not found', payoutRule: 'Payout formula (linear)', flat: 'Flat (THB)', perPct: 'Per 1% (THB)', saveRule: 'Save formula', computePayouts: 'Compute payouts', ruleSaved: 'Formula saved', payoutsComputed: 'Payouts computed', payoutHint: 'Payout = flat + (per-1% × score%) · negative = SC deduction', payouts: 'Payouts / deductions', noPayouts: 'No payouts yet (press Compute payouts)', colAmount: 'Amount (THB)', colStatus: 'Status', approve: 'Approve', reject: 'Reject', approveAll: 'Approve all', applySc: 'Apply to SC', poDraft: 'Draft', poApproved: 'Approved', poVoid: 'Void', poApplied: 'Applied', poSuperseded: 'Superseded', bonus: 'Bonus', deduction: 'Deduct', approved: 'Approved', rejected: 'Rejected', applied: 'Applied to SC', applyResult: 'Applied', colWorkIndex: 'Work index' };

  const [period, setPeriod] = useState<Period | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [flatBaht, setFlatBaht] = useState('');
  const [perPctBaht, setPerPctBaht] = useState('');
  const [savingRule, setSavingRule] = useState(false);
  const [computingPayouts, setComputingPayouts] = useState(false);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payoutBusy, setPayoutBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, aRes, rRes, eRes, ruleRes, poRes] = await Promise.all([
        fetch('/api/hr/eval/periods'),
        fetch(`/api/hr/eval/periods/${id}/assignments`),
        fetch(`/api/hr/eval/periods/${id}/results`),
        fetch('/api/hr/employees'),
        fetch(`/api/hr/eval/periods/${id}/payout-rule`),
        fetch(`/api/hr/eval/periods/${id}/payouts`),
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
      setPayouts(((await poRes.json()).data ?? []) as Payout[]);
    } catch {
      toast({ type: 'error', title: L.loadFailed });
    } finally {
      setLoading(false);
    }
  }, [id, L.loadFailed]);

  useEffect(() => { load(); }, [load]);

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
      await load();
    } finally { setComputingPayouts(false); }
  };

  const patchPayout = async (payload: Record<string, unknown>, busyKey: string, okTitle: string) => {
    setPayoutBusy(busyKey);
    try {
      const res = await fetch(`/api/hr/eval/periods/${id}/payouts`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast({ type: 'error', title: L.saveFailed, message: json?.error }); return; }
      toast({ type: 'success', title: okTitle });
      await load();
    } finally { setPayoutBusy(null); }
  };

  const applySc = async () => {
    setPayoutBusy('apply-sc');
    try {
      const res = await fetch(`/api/hr/eval/periods/${id}/apply-sc`, { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as { error?: string; data?: { applied?: number } };
      if (!res.ok) { toast({ type: 'error', title: L.saveFailed, message: json?.error }); return; }
      toast({ type: 'success', title: L.applied, message: `${L.applyResult}: ${json.data?.applied ?? 0}` });
      await load();
    } finally { setPayoutBusy(null); }
  };

  const nameById = (pid: string) => employees.find((e) => e.id === pid)?.name || pid.slice(0, 8);

  // Work index (attendance score) for the period's month — HR sees peer score + time
  // discipline side by side before deciding SC deductions. Names/ids come from results.
  const [workIndex, setWorkIndex] = useState<Record<string, WorkIndexScore>>({});
  useEffect(() => {
    if (!period?.period_month || results.length === 0) return;
    const month = period.period_month.slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const fromD = `${month}-01`;
    const toD = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const ids = results.map((r) => r.employee_id).join(',');
    (async () => {
      try {
        const res = await fetch(`/api/hr/attendance-index?user_ids=${ids}&from=${fromD}&to=${toD}`);
        const json = await res.json().catch(() => ({}));
        if (res.ok) setWorkIndex((json.data ?? {}) as Record<string, WorkIndexScore>);
      } catch { /* column simply shows — */ }
    })();
  }, [period?.period_month, results]);
  const hasDraft = payouts.some((p) => p.status === 'draft');
  const hasNegative = payouts.some((p) => p.amount_satang < 0 && (p.status === 'draft' || p.status === 'approved'));

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <Link href="/hr/evaluation" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600 dark:text-gray-400">
        <ArrowLeft className="h-4 w-4" /> {L.back}
      </Link>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !period ? (
        <EmptyState icon={Calculator} title={L.notFound} />
      ) : (
        <>
          <PageHeader
            title={period.title}
            subtitle={`${period.period_month?.slice(0, 7)} · ${period.max_score} pts`}
            actions={
              <StatusBadge
                tone={period.status === 'open' ? 'info' : period.status === 'closed' ? 'good' : period.status === 'void' ? 'neutral' : 'warn'}
                label={period.status}
              />
            }
          />

          {/* topics (criteria) — the "pick what to score on" step */}
          <CriteriaEditor periodId={id} isTh={isTh} periodStatus={period.status} onChange={load} />

          {/* assignments: guided per-branch wizard + the current assignment list */}
          <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <SectionHeading title={L.assignments} className="mb-3" />
            <AssignWizard periodId={id} isTh={isTh} onDone={load} />
            {assignments.length === 0 ? (
              <p className="mt-3 text-sm text-gray-400">{L.noAssignments}</p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-700">
                {assignments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-gray-900 dark:text-white">
                      {nameOf(a.evaluator)} <span className="text-gray-400">→</span> {nameOf(a.employee)}
                    </span>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={a.status === 'submitted' ? 'good' : 'warn'} label={a.status === 'submitted' ? L.submitted : L.assigned} />
                      <button onClick={() => removeAssignment(a.id)} aria-label={L.remove} title={L.remove} className="rounded p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* results */}
          <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <SectionHeading
              title={L.results}
              className="mb-3"
              extra={<Button size="sm" variant="outline" type="button" onClick={compute} isLoading={computing} icon={<Calculator className="h-4 w-4" />}>{L.compute}</Button>}
            />
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
                      <th className="px-3 py-2 text-right">{L.colWorkIndex}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {results.map((r) => (
                      <tr key={r.id} className="bg-white dark:bg-gray-800">
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{r.name || nameById(r.employee_id)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{r.evaluator_count}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900 dark:text-white">{r.score_pct == null ? '—' : `${Number(r.score_pct).toFixed(1)}%`}</td>
                        <td className="px-3 py-2 text-right"><WorkIndexBadge score={workIndex[r.employee_id]} isTh={isTh} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* payout rule (linear) */}
          <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <SectionHeading title={L.payoutRule} />
            <p className="mb-3 mt-1 text-xs text-gray-400">{L.payoutHint}</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.flat}
                <input type="number" inputMode="decimal" step={0.01} value={flatBaht} onChange={(e) => setFlatBaht(e.target.value)} placeholder="0.00" className="control mt-1 w-32" />
              </label>
              <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.perPct}
                <input type="number" inputMode="decimal" step={0.01} value={perPctBaht} onChange={(e) => setPerPctBaht(e.target.value)} placeholder="0.00" className="control mt-1 w-32" />
              </label>
              <Button size="sm" type="button" onClick={saveRule} isLoading={savingRule}>{L.saveRule}</Button>
              <Button size="sm" variant="outline" type="button" onClick={computePayouts} isLoading={computingPayouts}>{L.computePayouts}</Button>
            </div>
          </section>

          {/* payouts drill-down: HR sign-off (approve/void) + apply negatives to SC */}
          <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <SectionHeading
              title={L.payouts}
              className="mb-3"
              extra={
                <div className="flex gap-2">
                  {hasDraft && (
                    <Button size="sm" variant="outline" type="button" isLoading={payoutBusy === 'approve-all'} onClick={() => patchPayout({ approve_all: true }, 'approve-all', L.approved)}>{L.approveAll}</Button>
                  )}
                  {hasNegative && (
                    <Button size="sm" variant="outline" type="button" isLoading={payoutBusy === 'apply-sc'} onClick={applySc}>{L.applySc}</Button>
                  )}
                </div>
              }
            />
            {payouts.length === 0 ? (
              <p className="text-sm text-gray-400">{L.noPayouts}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2">{L.colEmployee}</th>
                      <th className="px-3 py-2 text-right">{L.colScore}</th>
                      <th className="px-3 py-2 text-right">{L.colAmount}</th>
                      <th className="px-3 py-2 text-center">{L.colStatus}</th>
                      <th className="px-3 py-2 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {payouts.map((p) => {
                      const baht = p.amount_satang / 100;
                      const neg = p.amount_satang < 0;
                      const statusMap: Record<string, { tone: StatusTone; l: string }> = {
                        draft: { tone: 'warn', l: L.poDraft }, approved: { tone: 'info', l: L.poApproved }, void: { tone: 'neutral', l: L.poVoid }, applied_to_payslip: { tone: 'good', l: L.poApplied }, superseded: { tone: 'neutral', l: L.poSuperseded },
                      };
                      const sb = statusMap[p.status] ?? { tone: 'neutral' as const, l: p.status };
                      const editable = p.status === 'draft' || p.status === 'approved';
                      return (
                        <tr key={p.id} className="bg-white dark:bg-gray-800">
                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{nameById(p.result?.employee_id ?? '')}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{p.result?.score_pct == null ? '—' : `${Number(p.result.score_pct).toFixed(1)}%`}</td>
                          <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', neg ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
                            {neg ? '' : '+'}{baht.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            <span className="ml-1 text-[10px] font-normal text-gray-400">{neg ? L.deduction : L.bonus}</span>
                          </td>
                          <td className="px-3 py-2 text-center"><StatusBadge tone={sb.tone} label={sb.l} /></td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1">
                              {p.status === 'draft' && (
                                <Button size="sm" variant="ghost" type="button" isLoading={payoutBusy === p.id} onClick={() => patchPayout({ payout_id: p.id, status: 'approved' }, p.id, L.approved)}>{L.approve}</Button>
                              )}
                              {editable && (
                                <Button size="sm" variant="ghost" type="button" isLoading={payoutBusy === p.id} onClick={() => patchPayout({ payout_id: p.id, status: 'void' }, p.id, L.rejected)}>{L.reject}</Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

interface WorkIndexScore { overall: number; band: 'excellent' | 'good' | 'fair' | 'poor' }

const BADGE_TONE: Record<WorkIndexScore['band'], string> = {
  excellent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  good: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  fair: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  poor: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};
const BAND_TH: Record<WorkIndexScore['band'], string> = { excellent: 'ดีเยี่ยม', good: 'ดี', fair: 'พอใช้', poor: 'ควรปรับปรุง' };
const BAND_EN: Record<WorkIndexScore['band'], string> = { excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Improve' };

// Attendance score of the SAME month as the eval period — peer score and time discipline are
// different dimensions, so this renders beside (never inside) the evaluation score.
function WorkIndexBadge({ score, isTh }: { score: WorkIndexScore | undefined; isTh: boolean }) {
  if (!score) return <span className="text-xs text-gray-300 dark:text-gray-600">—</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${BADGE_TONE[score.band]}`}>
      {score.overall} · {(isTh ? BAND_TH : BAND_EN)[score.band]}
    </span>
  );
}
