'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, Coins, ListChecks, Wallet } from 'lucide-react';
import {
  Button,
  PageHeader,
  KpiRow,
  StatTile,
  DataList,
  DataCard,
  StatusBadge,
  type StatusTone,
  toast,
} from '@/components/ui';
import { EmployeeName } from '@/components/hr/employee-name';

// HR queue for the stock fines HQ has forwarded (owner ask 2026-07-09). Each row is one store + month
// with fines awaiting HR (penalties.status = 'sent_hr'). HR either deducts them from that month's
// Service Charge pool ("หัก SV") or simply doesn't press — deferring carries the fines to next month.
// A group can only be deducted when its SC pool exists and is still a draft (pool_status === 'draft').
interface Person {
  staff_id: string;
  name: string;
  nickname: string | null;
  baht: number;
  count: number;
}
interface Group {
  key: string;
  store_id: string;
  store_name: string;
  month: string;
  total_baht: number;
  count: number;
  pool_status: string | null; // null = no SC pool yet, 'draft' = deductible, 'finalized' = locked
  people: Person[];
}

const nf = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtBaht = (n: number) => `฿${nf.format(n)}`;

export default function HrStockDeductionsPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? {
        title: 'หักค่าปรับสต๊อก',
        subtitle: 'ค่าปรับสต๊อกที่สำนักงานใหญ่ส่งมาให้ HR หักจากเซอร์วิสชาร์จ (หรือยกไปเดือนหน้า)',
        pendingGroups: 'รายการรอหัก',
        totalAwaiting: 'ยอดรวมรอหัก',
        monthPrefix: 'เดือน',
        fines: 'รายการ',
        deduct: 'หัก SV',
        deferBtn: 'ยังไม่หัก',
        deferNote: 'ไม่กด = ยังไม่หัก (ยกไปเดือนหน้า)',
        deferred: 'ยังไม่หัก — ยกไปเดือนหน้า',
        empty: 'ไม่มีค่าปรับรอหัก',
        noPoolHint: 'ยังไม่มีกอง SC เดือนนี้ — สร้าง/จัดสรร SC ก่อน',
        finalizedHint: 'กอง SC ปิดรอบแล้ว',
        statusDraft: 'พร้อมหัก',
        statusFinalized: 'ปิดรอบแล้ว',
        statusNoPool: 'ยังไม่มีกอง SC',
        deducted: 'หัก SV แล้ว',
        appliedMsg: (n: number) => `หักจากพนักงาน ${n} คน`,
        carryNote: 'ยกยอดบางส่วน (ยกไปเดือนหน้า)',
        failed: 'ทำรายการไม่สำเร็จ',
      }
    : {
        title: 'Stock deductions',
        subtitle: 'Stock fines HQ forwarded for HR to deduct from Service Charge (or carry to next month)',
        pendingGroups: 'Pending queues',
        totalAwaiting: 'Total awaiting',
        monthPrefix: 'Month',
        fines: 'fines',
        deduct: 'Deduct from SC',
        deferBtn: 'Not yet',
        deferNote: 'Not pressing = not deducted (carried to next month)',
        deferred: 'Not deducted — carried to next month',
        empty: 'No fines awaiting deduction',
        noPoolHint: 'No SC pool for this month yet — create/allocate SC first',
        finalizedHint: 'SC pool is closed',
        statusDraft: 'Ready to deduct',
        statusFinalized: 'Closed',
        statusNoPool: 'No SC pool yet',
        deducted: 'Deducted from SC',
        appliedMsg: (n: number) => `${n} ${n === 1 ? 'person' : 'people'} deducted`,
        carryNote: 'Partially carried (to next month)',
        failed: 'Action failed',
      };

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [deferred, setDeferred] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/stock-deductions');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error);
      setGroups((json.data?.groups ?? []) as Group[]);
      setDeferred(new Set()); // fresh data — un-collapse everything
    } catch {
      toast({ type: 'error', title: L.failed });
    } finally {
      setLoading(false);
    }
  }, [L.failed]);

  useEffect(() => {
    load();
  }, [load]);

  const applyDeduction = useCallback(
    async (group: Group) => {
      setBusy(group.key);
      try {
        const res = await fetch('/api/hr/service-charge/apply-stock-penalties', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store_id: group.store_id, period_month: group.month }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error);
        const applied = Number(json.data?.applied ?? 0);
        const carry = Number(json.data?.carry_satang ?? 0);
        toast({
          type: 'success',
          title: L.deducted,
          message: `${L.appliedMsg(applied)}${carry > 0 ? ` · ${L.carryNote}` : ''}`,
        });
        await load(); // group disappears once its fines become 'deducted'
      } catch (e) {
        toast({ type: 'error', title: L.failed, message: e instanceof Error ? e.message : undefined });
      } finally {
        setBusy(null);
      }
    },
    [load, L]
  );

  // Deferring is just not pressing "หัก SV" — this only acknowledges + collapses the card locally.
  const deferGroup = useCallback(
    (key: string) => {
      toast({ type: 'info', title: L.deferred });
      setDeferred((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    },
    [L.deferred]
  );

  const visible = groups.filter((g) => !deferred.has(g.key));
  const pendingCount = visible.length;
  const totalAwaiting = visible.reduce((s, g) => s + g.total_baht, 0);

  const poolBadge = (status: string | null): { tone: StatusTone; label: string } => {
    if (status === 'draft') return { tone: 'info', label: L.statusDraft };
    if (status === 'finalized') return { tone: 'neutral', label: L.statusFinalized };
    return { tone: 'neutral', label: L.statusNoPool };
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader title={L.title} subtitle={L.subtitle} />

      <KpiRow cols={4}>
        <StatTile
          label={L.pendingGroups}
          value={pendingCount}
          icon={ListChecks}
          tone={pendingCount > 0 ? 'warn' : 'default'}
        />
        <StatTile label={L.totalAwaiting} value={fmtBaht(totalAwaiting)} icon={Wallet} tone="accent" />
      </KpiRow>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
          {L.empty}
        </p>
      ) : (
        <DataList>
          {visible.map((g) => {
            const badge = poolBadge(g.pool_status);
            const canDeduct = g.pool_status === 'draft';
            const disabledHint =
              g.pool_status === null ? L.noPoolHint : g.pool_status === 'finalized' ? L.finalizedHint : null;
            return (
              <DataCard
                key={g.key}
                accent={canDeduct ? 'warn' : 'neutral'}
                title={`${g.store_name} · ${L.monthPrefix} ${g.month}`}
                subtitle={`${g.count} ${L.fines} · ${fmtBaht(g.total_baht)}`}
                status={<StatusBadge tone={badge.tone} label={badge.label} icon={Coins} />}
                actions={
                  <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-gray-400">
                      {disabledHint ?? L.deferNote}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === g.key}
                        onClick={() => deferGroup(g.key)}
                      >
                        {L.deferBtn}
                      </Button>
                      <Button
                        size="sm"
                        disabled={!canDeduct || busy === g.key}
                        isLoading={busy === g.key}
                        onClick={() => applyDeduction(g)}
                      >
                        {L.deduct}
                      </Button>
                    </div>
                  </div>
                }
              >
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {g.people.map((p) => (
                    <span
                      key={p.staff_id}
                      className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-700/60 dark:text-gray-300"
                    >
                      <EmployeeName name={p.name} nickname={p.nickname} />
                      <span className="font-medium text-gray-800 dark:text-gray-100">{fmtBaht(p.baht)}</span>
                    </span>
                  ))}
                </div>
              </DataCard>
            );
          })}
        </DataList>
      )}
    </div>
  );
}
