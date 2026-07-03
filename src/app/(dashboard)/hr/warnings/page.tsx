'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Inbox, Plus, Printer, FileText, Ban, PenLine } from 'lucide-react';
import {
  Button,
  Badge,
  Select,
  Modal,
  ModalFooter,
  toast,
} from '@/components/ui';
import {
  SignaturePad,
  type SignaturePadHandle,
} from '@/components/ui/signature-pad';

// ── Types (per P3.2 API contract) ──────────────────────────────────────────
type Level =
  | 'verbal'
  | 'deduct_25'
  | 'deduct_50'
  | 'deduct_100'
  | 'deduct_200'
  | 'amount_baht';
type Status = 'active' | 'acknowledged' | 'void';
type SignRole = 'employee' | 'manager' | 'hr';

interface Person {
  id: string;
  display_name: string | null;
  username: string | null;
}
interface Signature {
  role: SignRole;
  signed_by: string | null;
  signed_at: string | null;
}
interface Warning {
  id: string;
  user_id: string;
  issued_by: string;
  store_id: string | null;
  level: Level;
  sc_deduct_percent: number | null;
  amount_satang: number | null;
  sc_deduct_cycles: number | null;
  reason: string;
  detail: string | null;
  evidence_path: string | null;
  issued_at: string | null;
  expires_at: string | null;
  status: Status;
  employee: Person | null;
  issuer: Person | null;
  signatures: Signature[];
}

interface StoreOpt {
  id: string;
  store_name: string;
}
interface Employee {
  profile: Person;
  stores: StoreOpt[];
}

// Money is stored in satang (integer). Baht input × 100 = satang.
const SATANG_PER_BAHT = 100;

const LEVELS: Level[] = [
  'verbal',
  'deduct_25',
  'deduct_50',
  'deduct_100',
  'deduct_200',
  'amount_baht',
];

const LEVEL_BADGE: Record<Level, 'default' | 'warning' | 'danger' | 'info'> = {
  verbal: 'default',
  deduct_25: 'warning',
  deduct_50: 'warning',
  deduct_100: 'danger',
  deduct_200: 'danger',
  amount_baht: 'info',
};

const STATUS_BADGE: Record<Status, 'warning' | 'success' | 'default'> = {
  active: 'warning',
  acknowledged: 'success',
  void: 'default',
};

const SIGN_ROLES: SignRole[] = ['employee', 'manager', 'hr'];
const STATUS_FILTERS = ['all', 'active', 'acknowledged', 'void'] as const;

const inputCls =
  'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

function bahtFromSatang(satang: number): string {
  return (satang / SATANG_PER_BAHT).toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('th-TH');
}
function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('th-TH');
}

const PRINT_CSS = `@media print { @page { margin: 1.6cm; } }`;

export default function HrWarningsPage() {
  const t = useTranslations('hr.warnings');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<Warning[]>([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [filterStore, setFilterStore] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // issue modal
  const [issueOpen, setIssueOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [level, setLevel] = useState<Level>('verbal');
  const [amountBaht, setAmountBaht] = useState('');
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [evidence, setEvidence] = useState<File | null>(null);

  // sign modal
  const [signTarget, setSignTarget] = useState<{ id: string; role: 'manager' | 'hr' } | null>(null);
  const [signing, setSigning] = useState(false);
  const signRef = useRef<SignaturePadHandle | null>(null);

  // void modal
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  // print
  const [printRow, setPrintRow] = useState<Warning | null>(null);

  const levelLabel = useCallback((l: Level) => t(`level_${l}`), [t]);
  const effectHint = useCallback((l: Level) => t(`effect_${l}`), [t]);
  const statusLabel = useCallback((s: Status) => t(`status_${s}`), [t]);
  const roleLabel = useCallback((r: SignRole) => t(`role_${r}`), [t]);

  // ── Employee source: GET /api/hr/employees ────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/employees');
        const json = await res.json().catch(() => ({}));
        setEmployees((json.data ?? []) as Employee[]);
      } catch {
        setEmployees([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStore) params.set('store_id', filterStore);
      if (filterStatus !== 'all') params.set('status', filterStatus);
      const qs = params.toString();
      const res = await fetch(`/api/hr/warnings${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setRows((json.data ?? []) as Warning[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filterStore, filterStatus]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.profile.id === employeeId) ?? null,
    [employees, employeeId]
  );

  // Store filter options: unique stores across all manageable employees.
  const filterStoreOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) {
      for (const s of e.stores ?? []) map.set(s.id, s.store_name);
    }
    return [
      { value: '', label: t('allStores') },
      ...Array.from(map, ([value, label]) => ({ value, label })),
    ];
  }, [employees, t]);

  const openIssue = () => {
    setEmployeeId('');
    setStoreId('');
    setLevel('verbal');
    setAmountBaht('');
    setReason('');
    setDetail('');
    setEvidence(null);
    setIssueOpen(true);
  };

  const canSubmit =
    Boolean(employeeId && reason.trim()) &&
    (level !== 'amount_baht' || Number(amountBaht) > 0) &&
    !submitting;

  const submitIssue = useCallback(async () => {
    if (!employeeId || !reason.trim()) return;
    if (level === 'amount_baht' && !(Number(amountBaht) > 0)) {
      toast({ type: 'error', title: t('amountRequired') });
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('user_id', employeeId);
      if (storeId) fd.append('store_id', storeId);
      fd.append('level', level);
      if (level === 'amount_baht') {
        fd.append('amount_satang', String(Math.round(Number(amountBaht) * SATANG_PER_BAHT)));
      }
      fd.append('reason', reason.trim());
      if (detail.trim()) fd.append('detail', detail.trim());
      if (evidence) fd.append('evidence', evidence);
      // NOTE: do not set Content-Type — browser sets the multipart boundary.
      const res = await fetch('/api/hr/warnings', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || json?.message);
      toast({ type: 'success', title: t('issued') });
      setIssueOpen(false);
      await load();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error && e.message ? e.message : t('issueFailed') });
    } finally {
      setSubmitting(false);
    }
  }, [employeeId, storeId, level, amountBaht, reason, detail, evidence, t, load]);

  // ── Sign (manager / hr) ───────────────────────────────────────────────────
  const submitSign = useCallback(async () => {
    if (!signTarget) return;
    const pad = signRef.current;
    if (!pad || pad.isEmpty()) {
      toast({ type: 'warning', title: t('signRequired') });
      return;
    }
    const signature = pad.toDataURL();
    if (!signature) {
      toast({ type: 'warning', title: t('signRequired') });
      return;
    }
    setSigning(true);
    try {
      const res = await fetch(`/api/hr/warnings/${signTarget.id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, role: signTarget.role }),
      });
      if (res.status === 409) {
        toast({ type: 'warning', title: t('alreadySigned') });
        setSignTarget(null);
        await load();
        return;
      }
      if (!res.ok) throw new Error();
      toast({ type: 'success', title: t('signed') });
      setSignTarget(null);
      await load();
    } catch {
      toast({ type: 'error', title: t('signFailed') });
    } finally {
      setSigning(false);
    }
  }, [signTarget, t, load]);

  // ── Void ──────────────────────────────────────────────────────────────────
  const submitVoid = useCallback(async () => {
    if (!voidId || !voidReason.trim()) return;
    setVoiding(true);
    try {
      const res = await fetch(`/api/hr/warnings/${voidId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: voidReason.trim() }),
      });
      if (res.status === 409) {
        toast({ type: 'warning', title: t('voidFailed') });
        setVoidId(null);
        await load();
        return;
      }
      if (!res.ok) throw new Error();
      toast({ type: 'success', title: t('voided') });
      setVoidId(null);
      setVoidReason('');
      await load();
    } catch {
      toast({ type: 'error', title: t('voidFailed') });
    } finally {
      setVoiding(false);
    }
  }, [voidId, voidReason, t, load]);

  const doPrint = useCallback((row: Warning) => {
    setPrintRow(row);
    // Let the print-only DOM commit before invoking the print dialog.
    setTimeout(() => window.print(), 60);
  }, []);

  // SC effect text for a recorded warning.
  const scEffect = useCallback(
    (w: Warning): string => {
      if (w.level === 'verbal') return t('effect_verbal');
      const cycles = w.sc_deduct_cycles && w.sc_deduct_cycles > 1 ? ` ${t('cycles', { n: w.sc_deduct_cycles })}` : '';
      if (w.level === 'amount_baht' && w.amount_satang != null) {
        return `฿${bahtFromSatang(w.amount_satang)}${cycles}`;
      }
      if (w.sc_deduct_percent != null) return `${w.sc_deduct_percent}%${cycles}`;
      return '—';
    },
    [t]
  );

  const signedRoles = (w: Warning) => new Set(w.signatures.map((s) => s.role));

  const statusOptions = STATUS_FILTERS.map((s) => ({
    value: s,
    label: s === 'all' ? t('statusAll') : statusLabel(s as Status),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <style>{PRINT_CSS}</style>

      {/* On-screen content (hidden while printing) */}
      <div className="space-y-4 print:hidden">
        {/* header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
          </div>
          <Button size="sm" onClick={openIssue} className="shrink-0" icon={<Plus className="h-4 w-4" />}>
            {t('issue')}
          </Button>
        </div>

        {/* filters */}
        <div className="grid grid-cols-2 gap-3">
          <Select
            label={t('filterStore')}
            value={filterStore}
            onChange={(e) => setFilterStore(e.target.value)}
            options={filterStoreOptions}
          />
          <Select
            label={t('filterStatus')}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            options={statusOptions}
          />
        </div>

        {/* list */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
            <Inbox className="h-8 w-8" />
            {t('noWarnings')}
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((w) => {
              const signed = signedRoles(w);
              return (
                <li
                  key={w.id}
                  className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {w.employee?.display_name ?? w.employee?.username ?? '—'}
                        </span>
                        <Badge variant={LEVEL_BADGE[w.level]} size="sm">
                          {levelLabel(w.level)}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('scEffect')}: {scEffect(w)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{w.reason}</p>
                      {w.detail && (
                        <p className="text-xs text-gray-400 dark:text-gray-500">{w.detail}</p>
                      )}
                      <p className="text-[11px] text-gray-400">
                        {t('issuedAt')}: {formatDateTime(w.issued_at)}
                        {w.expires_at && ` · ${t('expiresAt')}: ${formatDate(w.expires_at)}`}
                      </p>
                    </div>
                    <Badge variant={STATUS_BADGE[w.status]} size="sm">
                      {statusLabel(w.status)}
                    </Badge>
                  </div>

                  {/* 3-party signature chips */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {SIGN_ROLES.map((role) => {
                      const done = signed.has(role);
                      return (
                        <span
                          key={role}
                          className={
                            done
                              ? 'inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10px] font-medium text-gray-400 dark:border-gray-600'
                          }
                        >
                          {done ? '✓' : '○'} {roleLabel(role)}
                        </span>
                      );
                    })}
                  </div>

                  {/* actions */}
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    {w.status !== 'void' && !signed.has('manager') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSignTarget({ id: w.id, role: 'manager' })}
                        icon={<PenLine className="h-3.5 w-3.5" />}
                      >
                        {t('signAsManager')}
                      </Button>
                    )}
                    {w.status !== 'void' && !signed.has('hr') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSignTarget({ id: w.id, role: 'hr' })}
                        icon={<PenLine className="h-3.5 w-3.5" />}
                      >
                        {t('signAsHr')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => doPrint(w)}
                      icon={<Printer className="h-3.5 w-3.5" />}
                    >
                      {t('print')}
                    </Button>
                    {w.status !== 'void' && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          setVoidReason('');
                          setVoidId(w.id);
                        }}
                        icon={<Ban className="h-3.5 w-3.5" />}
                      >
                        {t('void')}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Print-only detail (single warning) */}
      <div className="hidden print:block">
        {printRow && (
          <div id="warning-print-area" className="text-black">
            <h1 className="mb-1 text-lg font-bold">{t('printTitle')}</h1>
            <p className="mb-4 text-xs text-gray-600">{t('printSubtitle')}</p>
            <table className="w-full border-collapse text-sm">
              <tbody>
                <PrintRow label={t('employee')} value={printRow.employee?.display_name ?? printRow.employee?.username ?? '—'} />
                <PrintRow label={t('issuedBy')} value={printRow.issuer?.display_name ?? printRow.issuer?.username ?? '—'} />
                <PrintRow label={t('level')} value={levelLabel(printRow.level)} />
                <PrintRow label={t('scEffect')} value={scEffect(printRow)} />
                <PrintRow label={t('reason')} value={printRow.reason} />
                <PrintRow label={t('detail')} value={printRow.detail || '—'} />
                <PrintRow label={t('issuedAt')} value={formatDateTime(printRow.issued_at)} />
                <PrintRow label={t('expiresAt')} value={formatDate(printRow.expires_at)} />
                <PrintRow label={t('status')} value={statusLabel(printRow.status)} />
              </tbody>
            </table>

            <h2 className="mb-2 mt-6 text-sm font-semibold">{t('signaturesHeading')}</h2>
            <div className="flex gap-8">
              {SIGN_ROLES.map((role) => {
                const sig = printRow.signatures.find((s) => s.role === role);
                return (
                  <div key={role} className="flex-1 text-center">
                    <div className="mb-1 h-16 border-b border-gray-500" />
                    <p className="text-xs font-medium">{roleLabel(role)}</p>
                    <p className="text-[10px] text-gray-600">
                      {sig ? formatDateTime(sig.signed_at) : t('notSigned')}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Issue modal */}
      <Modal isOpen={issueOpen} onClose={() => !submitting && setIssueOpen(false)} title={t('issueTitle')} size="lg">
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('employee')}
            <select
              value={employeeId}
              onChange={(e) => {
                setEmployeeId(e.target.value);
                setStoreId('');
              }}
              className={inputCls}
            >
              <option value="">{t('selectEmployee')}</option>
              {employees.map((emp) => (
                <option key={emp.profile.id} value={emp.profile.id}>
                  {emp.profile.display_name ?? emp.profile.username ?? emp.profile.id}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('store')}
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className={inputCls}
              disabled={!selectedEmployee}
            >
              <option value="">{t('storeCompanyWide')}</option>
              {(selectedEmployee?.stores ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.store_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('level')}
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as Level)}
              className={inputCls}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {levelLabel(l)} · {effectHint(l)}
                </option>
              ))}
            </select>
          </label>

          {level === 'amount_baht' && (
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('amountBaht')}
              <input
                type="number"
                min="0"
                step="0.01"
                value={amountBaht}
                onChange={(e) => setAmountBaht(e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </label>
          )}

          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('reason')}
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
              className={inputCls}
            />
          </label>

          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('detail')}
            <textarea
              rows={3}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder={t('detailPlaceholder')}
              className={inputCls}
            />
          </label>

          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('evidence')}
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setEvidence(e.target.files?.[0] ?? null)}
              className={`${inputCls} file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-600 dark:file:bg-indigo-900/40 dark:file:text-indigo-300`}
            />
          </label>
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIssueOpen(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button onClick={submitIssue} isLoading={submitting} disabled={!canSubmit}>
            {t('submit')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Sign modal */}
      <Modal
        isOpen={signTarget !== null}
        onClose={() => !signing && setSignTarget(null)}
        title={t('signTitle')}
        description={signTarget ? roleLabel(signTarget.role) : undefined}
        size="lg"
      >
        <div className="space-y-2">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('signPrompt')}</p>
          <SignaturePad ref={signRef} />
        </div>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => signRef.current?.clear()} disabled={signing}>
            {t('clear')}
          </Button>
          <Button size="sm" onClick={submitSign} isLoading={signing}>
            {t('submit')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Void modal */}
      <Modal
        isOpen={voidId !== null}
        onClose={() => !voiding && setVoidId(null)}
        title={t('voidTitle')}
        size="md"
      >
        <div className="space-y-2">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('voidPrompt')}</p>
          <textarea
            rows={3}
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder={t('voidReasonPlaceholder')}
            className={inputCls}
          />
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setVoidId(null)} disabled={voiding}>
            {t('cancel')}
          </Button>
          <Button variant="danger" onClick={submitVoid} isLoading={voiding} disabled={!voidReason.trim()}>
            {t('void')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function PrintRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-300 align-top">
      <td className="w-40 py-1.5 pr-3 font-medium text-gray-700">{label}</td>
      <td className="py-1.5 whitespace-pre-wrap">{value}</td>
    </tr>
  );
}
