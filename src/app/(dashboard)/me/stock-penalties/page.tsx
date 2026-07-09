'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Gauge, Loader2 } from 'lucide-react';
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  DataList,
  DataCard,
  type StatusTone,
  toast,
} from '@/components/ui';
import { formatThaiDate } from '@/lib/utils/format';

// Employee self-service: my stock-penalty / SOP-point history (penalties.staff_id = me).
// Read-only, self-contained bilingual like the other /me/* pages. Auth is enforced by the
// API route (/api/hr/ess/stock-penalties) — every employee may read their own rows.
interface PenaltyRow {
  id: string;
  penalty_code: string | null;
  reason: string | null;
  amount: number | null;
  status: string | null;
  business_date: string | null;
  week_seq: number | null;
  month_year: string | null;
  created_at: string;
  included_in_quota: boolean | null;
}

interface PenaltyResponse {
  rows: PenaltyRow[];
  month_points: number;
  month_baht: number;
}

function bahtLabel(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export default function MyStockPenaltiesPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? {
        title: 'คะแนน/ค่าปรับสต๊อก',
        subtitle: 'ประวัติคะแนน SOP และค่าปรับสต๊อกของฉัน',
        empty: 'ยังไม่มีรายการคะแนน/ค่าปรับ',
        monthPrefix: 'เดือนนี้',
        times: 'ครั้ง',
        pending: 'รอหัก',
        cancelled: 'ยกเลิก',
        recorded: 'บันทึกแล้ว',
        noCharge: 'ไม่หัก',
        loadFail: 'โหลดไม่สำเร็จ',
        noDetail: '(ไม่มีรายละเอียด)',
      }
    : {
        title: 'Stock penalties',
        subtitle: 'My SOP points and stock-penalty history',
        empty: 'No penalty records yet',
        monthPrefix: 'This month',
        times: '',
        pending: 'Pending',
        cancelled: 'Cancelled',
        recorded: 'Recorded',
        noCharge: '—',
        loadFail: 'Load failed',
        noDetail: 'No description',
      };

  const [rows, setRows] = useState<PenaltyRow[]>([]);
  const [monthPoints, setMonthPoints] = useState(0);
  const [monthBaht, setMonthBaht] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/stock-penalties');
      if (!res.ok) throw new Error('load failed');
      const json = (await res.json()) as PenaltyResponse;
      setRows(json.rows ?? []);
      setMonthPoints(json.month_points ?? 0);
      setMonthBaht(json.month_baht ?? 0);
    } catch {
      toast({ type: 'error', title: L.loadFail });
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // status → tone + label. 'pending' warns, 'cancelled' is muted, anything else reads as settled.
  const statusMeta = (status: string | null): { tone: StatusTone; label: string } => {
    switch (status) {
      case 'pending':
        return { tone: 'warn', label: L.pending };
      case 'cancelled':
        return { tone: 'neutral', label: L.cancelled };
      default:
        return { tone: 'good', label: status ?? L.recorded };
    }
  };

  const amountLabel = (amount: number | null): string => {
    if (amount === null || amount === undefined) return '—';
    if (amount === 0) return L.noCharge;
    return `฿${bahtLabel(amount)}`;
  };

  const summaryText = `${L.monthPrefix}: ${monthPoints}${L.times ? ` ${L.times}` : ''} · ฿${bahtLabel(monthBaht)}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageHeader title={L.title} subtitle={L.subtitle} />

      <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-800/60 dark:bg-rose-900/20">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
          <Gauge className="h-5 w-5" />
        </div>
        <span className="text-sm font-semibold text-rose-800 dark:text-rose-200">
          {summaryText}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Gauge} title={L.empty} />
      ) : (
        <DataList>
          {rows.map((row) => {
            const meta = statusMeta(row.status);
            const dateLabel = formatThaiDate(row.business_date ?? row.created_at);
            const amount = row.amount ?? null;
            return (
              <DataCard
                key={row.id}
                accent={meta.tone === 'neutral' ? 'neutral' : meta.tone === 'warn' ? 'warn' : 'good'}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {row.penalty_code && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        {row.penalty_code}
                      </span>
                    )}
                    <span className="text-sm">{row.reason ?? L.noDetail}</span>
                  </span>
                }
                status={<StatusBadge tone={meta.tone} label={meta.label} />}
                value={
                  <span
                    className={
                      amount && amount > 0
                        ? 'text-sm font-semibold text-rose-600 dark:text-rose-400'
                        : 'text-sm text-gray-400'
                    }
                  >
                    {amountLabel(amount)}
                  </span>
                }
              >
                <span>{dateLabel}</span>
              </DataCard>
            );
          })}
        </DataList>
      )}
    </div>
  );
}
