'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Wrench, Plus, Store, Loader2, ChevronRight, AlertTriangle } from 'lucide-react';
import { Button, Card, EmptyState, Tabs, Badge } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { RepairStatusBadge } from '@/components/repairs/repair-status-badge';
import { RepairReportExport } from './_components/repair-report-export';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/stores/app-store';
import { useAuthStore } from '@/stores/auth-store';
import {
  OPEN_REPAIR_STATUSES,
  CLOSED_REPAIR_STATUSES,
  REPAIR_PRIORITY_LABELS,
} from '@/lib/repairs/status';
import type { RepairRequest } from '@/types/database';

type TabKey = 'open' | 'closed' | 'all';
type ViewMode = 'current' | 'all';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

export default function RepairsListPage() {
  const { currentStoreId } = useAppStore();
  const { user } = useAuthStore();

  const isAdmin = user?.role === 'owner' || user?.role === 'accountant';
  const canExport = isAdmin || user?.role === 'manager';

  const [repairs, setRepairs] = useState<RepairRequest[]>([]);
  const [storeNames, setStoreNames] = useState<Record<string, string>>({});
  const [accessibleCount, setAccessibleCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('open');
  const [mode, setMode] = useState<ViewMode>(user?.role === 'technician' ? 'all' : 'current');

  // Load store names (any user can read active stores) + how many this user covers.
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('stores')
      .select('id, store_name')
      .eq('active', true)
      .then(({ data }) => {
        const list = (data as { id: string; store_name: string }[]) ?? [];
        const map: Record<string, string> = {};
        list.forEach((s) => (map[s.id] = s.store_name));
        setStoreNames(map);
        const accessible = isAdmin
          ? list.length
          : list.filter((s) => user?.storeIds?.includes(s.id)).length;
        setAccessibleCount(accessible || 1);
      });
  }, [isAdmin, user?.storeIds]);

  const fetchRepairs = useCallback(async () => {
    if (mode === 'current' && !currentStoreId) {
      setRepairs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      let query = supabase
        .from('repair_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      // 'all' mode relies on RLS to scope to the user's stores (admins see all).
      if (mode === 'current' && currentStoreId) {
        query = query.eq('store_id', currentStoreId);
      }
      const { data } = await query;
      setRepairs((data as RepairRequest[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [mode, currentStoreId]);

  useEffect(() => {
    fetchRepairs();
  }, [fetchRepairs]);

  const filtered = useMemo(() => {
    if (tab === 'all') return repairs;
    const set = tab === 'open' ? OPEN_REPAIR_STATUSES : CLOSED_REPAIR_STATUSES;
    return repairs.filter((r) => set.includes(r.status));
  }, [repairs, tab]);

  const showModeToggle = accessibleCount > 1;

  if (mode === 'current' && !currentStoreId) {
    return (
      <EmptyState icon={Store} title="ยังไม่ได้เลือกสาขา" description="กรุณาเลือกสาขาก่อน" />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white">
          <Wrench className="h-5 w-5 text-rose-500" />
          รายการแจ้งซ่อม
        </h1>
        <div className="flex items-center gap-2">
          {canExport && <RepairReportExport />}
          <Link href="/repairs/new">
            <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />}>
              แจ้งซ่อม
            </Button>
          </Link>
        </div>
      </div>

      {showModeToggle && (
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          {(['current', 'all'] as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                mode === m
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400',
              )}
            >
              {m === 'current' ? 'สาขานี้' : 'ทุกสาขาที่ดูแล'}
            </button>
          ))}
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'open', label: 'กำลังดำเนินการ' },
          { id: 'closed', label: 'เสร็จ/ปิดงาน' },
          { id: 'all', label: 'ทั้งหมด' },
        ]}
        activeTab={tab}
        onChange={(id) => setTab(id as TabKey)}
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Wrench} title="ไม่มีรายการ" description="ยังไม่มีใบแจ้งซ่อมในหมวดนี้" />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <Link key={r.id} href={`/repairs/${r.id}`}>
              <Card padding="none" className="transition-colors hover:ring-indigo-300 dark:hover:ring-indigo-700">
                <div className="flex items-center gap-3 p-3">
                  {r.photo_urls?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.photo_urls[0]}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                      <Wrench className="h-5 w-5 text-gray-400" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate font-medium text-gray-900 dark:text-white">
                        {r.title}
                      </p>
                      {r.priority === 'urgent' && (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {mode === 'all' && storeNames[r.store_id] && (
                        <Badge variant="outline" size="sm">
                          {storeNames[r.store_id]}
                        </Badge>
                      )}
                      {r.location && (
                        <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {r.location}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <RepairStatusBadge status={r.status} size="sm" />
                      <span className="text-[11px] text-gray-400">{formatDate(r.created_at)}</span>
                      {r.priority === 'urgent' && (
                        <span className="text-[11px] font-medium text-red-500">
                          {REPAIR_PRIORITY_LABELS.urgent}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
