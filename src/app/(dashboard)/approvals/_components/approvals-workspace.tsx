'use client';

/**
 * The venue manager's approval queue: leave requests from the staff of the venues they run.
 *
 * Reuses /api/hr/leaves and /api/hr/leaves/[id]/decide unchanged — both already gate on
 * hr_manager_scopes, so nothing here grants authority the API would not have granted anyway.
 * This screen exists because every other leave surface sits under /hr, which is HR-only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Inbox, CalendarRange, Check, X } from 'lucide-react';
import {
  Button,
  Select,
  PageHeader,
  DataList,
  DataCard,
  StatusBadge,
  SkeletonList,
  usePromptDialog,
  toast,
} from '@/components/ui';
import { formatThaiDate } from '@/lib/utils/format';
import { EmployeeName } from '@/components/hr/employee-name';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface LeaveRow {
  id: string;
  store_id: string | null;
  from_date: string;
  to_date: string;
  days: number;
  reason: string;
  status: Status;
  decision_note: string | null;
  requester: { full_name: string | null; display_name: string | null; username: string | null } | null;
  leave_type: { name_th: string; name_en: string } | null;
}

const STATUS_TONE: Record<Status, 'warn' | 'good' | 'critical' | 'neutral'> = {
  pending: 'warn',
  approved: 'good',
  rejected: 'critical',
  cancelled: 'neutral',
};

interface Props {
  stores: { id: string; store_name: string }[];
}

export function ApprovalsWorkspace({ stores }: Props) {
  const { prompt, dialog } = usePromptDialog();
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [tab, setTab] = useState<'pending' | 'decided'>('pending');
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ store_id: storeId, status: tab === 'pending' ? 'pending' : 'all' });
      const res = await fetch(`/api/hr/leaves?${params}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error);
      const all = (json.data ?? []) as LeaveRow[];
      setRows(tab === 'pending' ? all : all.filter((r) => r.status !== 'pending'));
    } catch {
      setRows([]);
      toast({ type: 'error', title: 'โหลดคำขอลาไม่สำเร็จ' });
    } finally {
      setLoading(false);
    }
  }, [storeId, tab]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    // A rejection has to say why — the employee sees this note, and "no" with no reason is the
    // thing that gets escalated to HR anyway.
    let note: string | undefined;
    if (decision === 'reject') {
      const input = await prompt({
        title: 'เหตุผลที่ไม่อนุมัติ',
        message: 'พนักงานจะเห็นข้อความนี้',
        confirmLabel: 'ไม่อนุมัติ',
      });
      if (input === null) return;
      if (!input.trim()) {
        toast({ type: 'error', title: 'ต้องระบุเหตุผล' });
        return;
      }
      note = input.trim();
    }

    setBusyId(id);
    try {
      const res = await fetch(`/api/hr/leaves/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'ทำรายการไม่สำเร็จ');
      toast({
        type: 'success',
        title: decision === 'approve' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติแล้ว',
        // The decide route applies the leave to the timesheet and returns a warning if that half
        // failed; surfacing it stops a silent half-done approval.
        message: typeof json.warning === 'string' ? json.warning : undefined,
      });
      await load();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ' });
    } finally {
      setBusyId(null);
    }
  };

  const storeOptions = useMemo(
    () => stores.map((s) => ({ value: s.id, label: s.store_name })),
    [stores]
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageHeader
        title="อนุมัติของสาขา"
        subtitle="ใบลาของพนักงานในสาขาที่คุณดูแล"
        actions={
          stores.length > 1 ? (
            <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} options={storeOptions} />
          ) : (
            <StatusBadge tone="neutral" label={stores[0]?.store_name ?? ''} />
          )
        }
      />

      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
        {(
          [
            { key: 'pending', label: 'รออนุมัติ' },
            { key: 'decided', label: 'ตัดสินแล้ว' },
          ] as const
        ).map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === tb.key
                ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-700 dark:text-indigo-300'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonList rows={4} />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
          <Inbox className="h-8 w-8" />
          {tab === 'pending' ? 'ไม่มีคำขอรออนุมัติ' : 'ยังไม่มีรายการที่ตัดสินแล้ว'}
        </div>
      ) : (
        <DataList>
          {rows.map((r) => (
            <DataCard
              key={r.id}
              accent={STATUS_TONE[r.status]}
              title={
                <>
                  <EmployeeName source={r.requester} />
                  {' · '}
                  {r.leave_type?.name_th ?? r.leave_type?.name_en ?? '—'}
                </>
              }
              subtitle={
                <span className="flex items-center gap-1">
                  <CalendarRange className="h-3.5 w-3.5 text-gray-400" />
                  {formatThaiDate(r.from_date)}
                  {r.to_date !== r.from_date ? ` – ${formatThaiDate(r.to_date)}` : ''} · {r.days} วัน
                </span>
              }
              status={<StatusBadge tone={STATUS_TONE[r.status]} label={r.status} />}
              actions={
                r.status === 'pending' ? (
                  <div className="flex gap-1.5">
                    <Button size="sm" onClick={() => decide(r.id, 'approve')} disabled={busyId === r.id}>
                      {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      อนุมัติ
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => decide(r.id, 'reject')}
                      disabled={busyId === r.id}
                    >
                      <X className="h-4 w-4" />
                      ไม่อนุมัติ
                    </Button>
                  </div>
                ) : undefined
              }
            >
              {r.reason && (
                <p className="text-xs text-gray-500 dark:text-gray-400">เหตุผล: {r.reason}</p>
              )}
              {r.decision_note && (
                <p className="mt-0.5 text-xs text-gray-400">หมายเหตุการตัดสิน: {r.decision_note}</p>
              )}
            </DataCard>
          ))}
        </DataList>
      )}
      {dialog}
    </div>
  );
}
