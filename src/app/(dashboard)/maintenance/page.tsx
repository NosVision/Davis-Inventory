'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Store, Loader2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Modal, ModalFooter, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { MonthCalendar, type CalendarItem } from '@/components/maintenance/month-calendar';
import { RepairPhotoInput } from '@/components/repairs/repair-photo-input';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/stores/app-store';
import { useAuthStore } from '@/stores/auth-store';
import type { MaintenanceOccurrence } from '@/types/database';

type OccurrenceRow = MaintenanceOccurrence & {
  schedule: { title: string; description: string | null } | null;
};
type ViewMode = 'current' | 'all';

const MAINTENANCE_STATUS_LABELS: Record<string, string> = {
  pending: 'รอดำเนินการ',
  completed: 'เสร็จแล้ว',
  skipped: 'ข้าม',
};

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-amber-400',
  completed: 'bg-emerald-500',
  skipped: 'bg-gray-300 dark:bg-gray-600',
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function MaintenancePage() {
  const { currentStoreId } = useAppStore();
  const { user } = useAuthStore();

  const isAdmin = user?.role === 'owner' || user?.role === 'accountant';
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [selectedDate, setSelectedDate] = useState<string | null>(todayYmd());
  const [rows, setRows] = useState<OccurrenceRow[]>([]);
  const [storeNames, setStoreNames] = useState<Record<string, string>>({});
  const [accessibleCount, setAccessibleCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>(user?.role === 'technician' ? 'all' : 'current');
  const [selected, setSelected] = useState<OccurrenceRow | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const canComplete = ['technician', 'manager', 'owner', 'accountant'].includes(user?.role ?? '');

  // Store names (any user can read active stores) + coverage count.
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

  const load = useCallback(async () => {
    if (mode === 'current' && !currentStoreId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      // Best-effort top-up of future occurrences (idempotent RPC).
      await supabase.rpc('generate_maintenance_occurrences');

      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const next = new Date(year, month, 1);
      const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;

      let query = supabase
        .from('maintenance_occurrences')
        .select('*, schedule:maintenance_schedules(title, description)')
        .gte('due_date', start)
        .lt('due_date', end)
        .order('due_date', { ascending: true });
      // 'all' mode relies on RLS to scope to the user's stores (admins see all).
      if (mode === 'current' && currentStoreId) {
        query = query.eq('store_id', currentStoreId);
      }
      const { data } = await query;
      setRows((data as OccurrenceRow[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [currentStoreId, year, month, mode]);

  useEffect(() => {
    load();
  }, [load]);

  function prevMonth() {
    setSelectedDate(null);
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    setSelectedDate(null);
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else setMonth((m) => m + 1);
  }

  function openRow(row: OccurrenceRow) {
    setSelected(row);
    setPhotos(row.photo_urls ?? []);
    setNotes(row.notes ?? '');
  }

  async function completeOccurrence() {
    if (!selected) return;
    if (photos.length === 0) {
      toast({ type: 'error', title: 'กรุณาแนบรูปอย่างน้อย 1 รูป' });
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('maintenance_occurrences')
        .update({
          status: 'completed',
          completed_by: user?.id ?? null,
          completed_at: new Date().toISOString(),
          photo_urls: photos,
          notes: notes.trim() || null,
        })
        .eq('id', selected.id);
      if (error) throw new Error(error.message);
      toast({ type: 'success', title: 'บันทึกงานประจำเรียบร้อย' });
      setSelected(null);
      await load();
    } catch (err) {
      toast({
        type: 'error',
        title: 'เกิดข้อผิดพลาด',
        message: err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ',
      });
    } finally {
      setBusy(false);
    }
  }

  const monthLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));

  const showModeToggle = accessibleCount > 1;

  if (mode === 'current' && !currentStoreId) {
    return <EmptyState icon={Store} title="ยังไม่ได้เลือกสาขา" description="กรุณาเลือกสาขาก่อน" />;
  }

  const calendarItems: CalendarItem[] = rows.map((r) => ({
    id: r.id,
    due_date: r.due_date,
    title:
      mode === 'all' && storeNames[r.store_id]
        ? `${storeNames[r.store_id]} · ${r.schedule?.title ?? 'งานประจำ'}`
        : r.schedule?.title ?? 'งานประจำ',
    status: r.status,
  }));

  const pendingCount = rows.filter((r) => r.status === 'pending').length;
  const doneCount = rows.filter((r) => r.status === 'completed').length;
  const dayRows = selectedDate ? rows.filter((r) => r.due_date === selectedDate) : [];
  const selectedLabel = selectedDate
    ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('th-TH', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white">
          <CalendarDays className="h-5 w-5 text-cyan-500" />
          ตารางงานประจำ
        </h1>
        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-[120px] text-center text-sm font-semibold text-gray-700 dark:text-gray-200">
            {monthLabel}
          </span>
          <button
            onClick={nextMonth}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {showModeToggle ? (
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
        ) : (
          <span />
        )}
        <div className="flex gap-2 text-xs">
          <span className="rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            ค้าง {pendingCount}
          </span>
          <span className="rounded-full bg-emerald-100 px-2 py-1 font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
            เสร็จ {doneCount}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          <MonthCalendar
            year={year}
            month={month}
            items={calendarItems}
            selectedDate={selectedDate}
            onSelectDay={setSelectedDate}
          />

          {selectedDate && (
            <Card padding="none">
              <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                <CalendarDays className="h-4 w-4 text-cyan-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  งานวันที่ {selectedLabel}
                </h3>
                <span className="ml-auto text-xs text-gray-400">{dayRows.length} งาน</span>
              </div>
              {dayRows.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-400">
                  ไม่มีงานประจำในวันนี้
                </p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {dayRows.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => openRow(r)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', STATUS_DOT[r.status])} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-900 dark:text-white">
                          {r.schedule?.title ?? 'งานประจำ'}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          {mode === 'all' && storeNames[r.store_id] && (
                            <Badge variant="outline" size="sm">
                              {storeNames[r.store_id]}
                            </Badge>
                          )}
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {MAINTENANCE_STATUS_LABELS[r.status] ?? r.status}
                          </span>
                        </div>
                      </div>
                      {r.status !== 'completed' && canComplete && (
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}
        </>
      )}

      <Modal
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.schedule?.title ?? 'งานประจำ'}
        description={
          selected
            ? `${storeNames[selected.store_id] ? `${storeNames[selected.store_id]} · ` : ''}กำหนด ${new Date(selected.due_date + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}`
            : undefined
        }
        size="md"
      >
        {selected && (
          <div className="space-y-3">
            {selected.schedule?.description && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {selected.schedule.description}
              </p>
            )}
            <div className="text-sm">
              สถานะ:{' '}
              <span className="font-medium">
                {MAINTENANCE_STATUS_LABELS[selected.status] ?? selected.status}
              </span>
            </div>

            {selected.status === 'completed' ? (
              <>
                {selected.notes && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">{selected.notes}</p>
                )}
                {selected.photo_urls?.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {selected.photo_urls.map((u) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={u} src={u} alt="" className="h-24 w-full rounded-lg object-cover" />
                    ))}
                  </div>
                )}
              </>
            ) : canComplete ? (
              <>
                <RepairPhotoInput label="รูปหลังทำงาน" value={photos} onChange={setPhotos} folder="maintenance" />
                <Card padding="sm">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="บันทึกเพิ่มเติม (ไม่บังคับ)"
                    className="w-full resize-none bg-transparent text-sm outline-none dark:text-white"
                  />
                </Card>
              </>
            ) : (
              <p className="text-sm text-gray-400">ยังไม่ได้ดำเนินการ</p>
            )}
          </div>
        )}
        {selected?.status !== 'completed' && canComplete && (
          <ModalFooter>
            <Button variant="ghost" onClick={() => setSelected(null)}>ปิด</Button>
            <Button variant="primary" isLoading={busy} onClick={completeOccurrence} disabled={photos.length === 0}>
              ทำเสร็จแล้ว
            </Button>
          </ModalFooter>
        )}
      </Modal>
    </div>
  );
}
