'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileSearch,
  Loader2,
  RefreshCw,
  Search,
  UserRound,
  Wine,
} from 'lucide-react';

import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select } from '@/components/ui';
import { AUDIT_ACTION_LABELS } from '@/lib/audit';
import {
  DEPOSIT_HISTORY_ACTIONS,
  DEPOSIT_HISTORY_PAGE_SIZE,
  getChangedFields,
  getDepositHistorySummary,
  type DepositHistorySource,
} from '@/lib/deposit/history';
import { formatThaiDateTime, formatNumber } from '@/lib/utils/format';
import { ROLE_LABELS, type UserRole } from '@/types/roles';

interface StoreOption {
  id: string;
  store_code: string;
  store_name: string;
}

interface DepositHistoryRow extends DepositHistorySource {
  id: string;
  store_id: string | null;
  action_type: string;
  table_name: string | null;
  record_id: string | null;
  changed_by: string | null;
  created_at: string;
  actor_name: string | null;
  actor_username: string | null;
  actor_role: string | null;
  store_name: string | null;
  store_code: string | null;
}

interface HistoryResponse {
  data: DepositHistoryRow[];
  count: number;
  page: number;
  pageSize: number;
  stores: StoreOption[];
  error?: string;
}

interface Filters {
  q: string;
  storeId: string;
  action: string;
  from: string;
  to: string;
}

const FIELD_LABELS: Record<string, string> = {
  action: 'การดำเนินการ',
  status: 'สถานะ',
  expiry_date: 'วันหมดอายุ',
  extended_days: 'จำนวนวันที่ต่ออายุ',
  is_vip: 'สถานะ VIP',
  quantity: 'จำนวนขวด',
  remaining_qty: 'จำนวนคงเหลือ',
  remaining_percent: '% คงเหลือ',
  bottle_percents: '% คงเหลือรายขวด',
  product_name: 'ชื่อสินค้า',
  customer_name: 'ชื่อลูกค้า',
  category: 'หมวดหมู่',
  notes: 'หมายเหตุ',
  reason: 'เหตุผล',
  transfer_code: 'เลขที่โอน',
  deposit_code: 'รหัสฝาก',
  confirm_photo_url: 'รูปยืนยัน',
};

const STATUS_LABELS: Record<string, string> = {
  pending_confirm: 'รอยืนยันรับฝาก',
  in_store: 'อยู่ที่ร้าน',
  pending_withdrawal: 'รอเบิก',
  transfer_pending: 'รอโอน',
  expired: 'หมดอายุ',
  withdrawn: 'เบิกแล้ว/ยกเลิก',
  approved: 'อนุมัติแล้ว',
  rejected: 'ปฏิเสธ',
  completed: 'เสร็จสิ้น',
};

function bangkokDate(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function defaultFilters(): Filters {
  return { q: '', storeId: '', action: '', from: bangkokDate(-29), to: bangkokDate() };
}

function actionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action]?.label ?? action;
}

function actionVariant(action: string): 'default' | 'success' | 'warning' | 'danger' | 'info' {
  if (/REJECTED|CANCELLED|EXPIRED/.test(action)) return 'danger';
  if (/CONFIRMED|COMPLETED|APPROVED|CREATED/.test(action)) return 'success';
  if (/EXTENDED|VIP|UPDATED/.test(action)) return 'warning';
  if (/REQUESTED|STATUS_CHANGED/.test(action)) return 'info';
  return 'default';
}

function actorRoleLabel(role: string | null): string {
  if (!role) return 'ระบบ';
  return ROLE_LABELS[role as UserRole] ?? role;
}

function actorDisplay(row: DepositHistoryRow): { name: string; role: string } {
  if (!row.changed_by && row.action_type.startsWith('CUSTOMER_')) {
    return { name: getDepositHistorySummary(row).customerName, role: 'ลูกค้า' };
  }
  return { name: row.actor_name || 'ระบบ', role: actorRoleLabel(row.actor_role) };
}

function formatValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null || value === '') return 'ไม่มี';
  if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่';
  if (typeof value === 'string') return STATUS_LABELS[value] ?? value;
  if (typeof value === 'number') return formatNumber(value, Number.isInteger(value) ? 0 : 2);
  return JSON.stringify(value, null, 2);
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? FIELD_LABELS[field.split('.').at(-1) ?? ''] ?? field;
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/20">
      <p className="text-sm font-medium text-red-700 dark:text-red-300">โหลดประวัติไม่สำเร็จ: {message}</p>
      <Button className="mt-3" size="sm" variant="outline" icon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>
        ลองใหม่
      </Button>
    </Card>
  );
}

export default function HqDepositHistoryPage() {
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<DepositHistoryRow[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<DepositHistoryRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const loadHistory = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page) });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    try {
      const response = await fetch(`/api/hq/deposit-history?${params}`, { signal, cache: 'no-store' });
      const payload = (await response.json()) as HistoryResponse;
      if (!response.ok) throw new Error(payload.error || 'ไม่สามารถอ่านข้อมูลได้');
      setRows(payload.data);
      setTotal(payload.count);
      setStores(payload.stores);
    } catch (fetchError) {
      if ((fetchError as Error).name !== 'AbortError') {
        setError(fetchError instanceof Error ? fetchError.message : 'ไม่สามารถอ่านข้อมูลได้');
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    const controller = new AbortController();
    loadHistory(controller.signal);
    return () => controller.abort();
  }, [loadHistory, reloadKey]);

  const pageCount = Math.max(1, Math.ceil(total / DEPOSIT_HISTORY_PAGE_SIZE));
  const visibleFrom = total === 0 ? 0 : (page - 1) * DEPOSIT_HISTORY_PAGE_SIZE + 1;
  const visibleTo = Math.min(total, page * DEPOSIT_HISTORY_PAGE_SIZE);
  const selectedSummary = selected ? getDepositHistorySummary(selected) : null;
  const selectedActor = selected ? actorDisplay(selected) : null;
  const selectedChanges = selected ? getChangedFields(selected.old_value, selected.new_value) : [];

  const actionOptions = useMemo(() => [
    { value: '', label: 'ทุกการดำเนินการ' },
    ...DEPOSIT_HISTORY_ACTIONS.map((action) => ({ value: action, label: actionLabel(action) })),
  ], []);

  const storeOptions = useMemo(() => [
    { value: '', label: 'ทุกสาขา' },
    ...stores.map((store) => ({
      value: store.id,
      label: `${store.store_code} — ${store.store_name}`,
    })),
  ], [stores]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setFilters(draft);
  };

  const resetFilters = () => {
    const next = defaultFilters();
    setDraft(next);
    setFilters(next);
    setPage(1);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="ประวัติระบบฝากเหล้า"
        subtitle="ตรวจสอบทุกการสร้าง แก้ไข ต่ออายุ เปลี่ยน VIP เบิก ยกเลิก และโอน พร้อมชื่อผู้ทำรายการ"
        actions={(
          <Button
            variant="outline"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => setReloadKey((value) => value + 1)}
            disabled={loading}
          >
            รีเฟรช
          </Button>
        )}
      />

      <div className="rounded-2xl border border-cyan-200 bg-gradient-to-r from-cyan-50 to-teal-50 p-4 dark:border-cyan-900/60 dark:from-cyan-950/30 dark:to-teal-950/20 sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-600 text-white shadow-sm">
            <Archive className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">Deposit Audit Register</p>
            <p className="mt-0.5 text-2xl font-bold text-gray-950 dark:text-white">{formatNumber(total)} รายการ</p>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            แสดงครั้งละ {DEPOSIT_HISTORY_PAGE_SIZE} รายการ · ค่าเริ่มต้นย้อนหลัง 30 วัน
          </div>
        </div>
      </div>

      <Card>
        <form onSubmit={applyFilters} className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="md:col-span-2 xl:col-span-2">
            <Input
              label="ค้นหา"
              placeholder="รหัสฝาก ลูกค้า สินค้า หรือผู้ทำรายการ"
              leftIcon={<Search className="h-4 w-4" />}
              value={draft.q}
              onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))}
            />
          </div>
          <Select
            label="สาขา"
            value={draft.storeId}
            options={storeOptions}
            onChange={(event) => setDraft((current) => ({ ...current, storeId: event.target.value }))}
          />
          <Select
            label="การดำเนินการ"
            value={draft.action}
            options={actionOptions}
            onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}
          />
          <Input
            label="ตั้งแต่วันที่"
            type="date"
            value={draft.from}
            onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
          />
          <Input
            label="ถึงวันที่"
            type="date"
            value={draft.to}
            onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
          />
          <div className="flex gap-2 md:col-span-2 xl:col-span-6 xl:justify-end">
            <Button type="button" variant="ghost" onClick={resetFilters}>ล้างตัวกรอง</Button>
            <Button type="submit" icon={<FileSearch className="h-4 w-4" />}>ค้นหาประวัติ</Button>
          </div>
        </form>
      </Card>

      {error ? (
        <ErrorPanel message={error} onRetry={() => setReloadKey((value) => value + 1)} />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700 sm:px-5">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">รายการประวัติ</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {loading ? 'กำลังโหลด…' : `แสดง ${formatNumber(visibleFrom)}–${formatNumber(visibleTo)} จาก ${formatNumber(total)}`}
              </p>
            </div>
            <CalendarDays className="h-5 w-5 text-cyan-600" />
          </div>

          {loading ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-600" /> กำลังอ่านประวัติ
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={FileSearch}
                title="ไม่พบประวัติ"
                description="ลองเปลี่ยนคำค้น ช่วงวันที่ สาขา หรือประเภทการดำเนินการ"
              />
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1050px] text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
                    <tr>
                      <th className="px-5 py-3 font-semibold">วันเวลา</th>
                      <th className="px-4 py-3 font-semibold">รหัสฝาก / ลูกค้า</th>
                      <th className="px-4 py-3 font-semibold">สินค้า</th>
                      <th className="px-4 py-3 font-semibold">สาขา</th>
                      <th className="px-4 py-3 font-semibold">ผู้ทำรายการ</th>
                      <th className="px-4 py-3 font-semibold">การดำเนินการ</th>
                      <th className="px-5 py-3 text-right font-semibold">รายละเอียด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map((row) => {
                      const summary = getDepositHistorySummary(row);
                      const actor = actorDisplay(row);
                      return (
                        <tr key={row.id} className="hover:bg-cyan-50/50 dark:hover:bg-cyan-950/10">
                          <td className="whitespace-nowrap px-5 py-3 text-gray-600 dark:text-gray-300">{formatThaiDateTime(row.created_at)}</td>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-gray-900 dark:text-white">{summary.depositCode}</p>
                            <p className="max-w-48 truncate text-xs text-gray-500">{summary.customerName}</p>
                          </td>
                          <td className="max-w-52 truncate px-4 py-3 text-gray-700 dark:text-gray-200">{summary.productName}</td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                            <p>{row.store_name || '-'}</p>
                            <p className="text-xs text-gray-400">{row.store_code || ''}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-800 dark:text-gray-100">{actor.name}</p>
                            <p className="text-xs text-gray-400">{actor.role}</p>
                          </td>
                          <td className="px-4 py-3"><Badge variant={actionVariant(row.action_type)}>{actionLabel(row.action_type)}</Badge></td>
                          <td className="px-5 py-3 text-right">
                            <Button size="sm" variant="ghost" onClick={() => setSelected(row)}>เปิดดู</Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-gray-100 dark:divide-gray-700 lg:hidden">
                {rows.map((row) => {
                  const summary = getDepositHistorySummary(row);
                  const actor = actorDisplay(row);
                  return (
                    <button key={row.id} type="button" onClick={() => setSelected(row)} className="block w-full p-4 text-left hover:bg-cyan-50/50 dark:hover:bg-cyan-950/10">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900 dark:text-white">{summary.depositCode}</p>
                          <p className="truncate text-sm text-gray-600 dark:text-gray-300">{summary.customerName} · {summary.productName}</p>
                        </div>
                        <Badge variant={actionVariant(row.action_type)} className="shrink-0">{actionLabel(row.action_type)}</Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{formatThaiDateTime(row.created_at)}</span>
                        <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{row.store_name || '-'}</span>
                        <span className="col-span-2 flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{actor.name} ({actor.role})</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {!loading && total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 dark:border-gray-700 sm:px-5">
              <p className="text-xs text-gray-500">หน้า {formatNumber(page)} จาก {formatNumber(pageCount)}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" icon={<ChevronLeft className="h-4 w-4" />} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>ก่อนหน้า</Button>
                <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
                  ถัดไป <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Modal
        isOpen={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="รายละเอียดประวัติฝากเหล้า"
        description={selected ? `${actionLabel(selected.action_type)} · ${formatThaiDateTime(selected.created_at)}` : undefined}
        size="full"
      >
        {selected && selectedSummary && selectedActor && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: 'รหัสฝาก', value: selectedSummary.depositCode, icon: Wine },
                { label: 'ลูกค้า', value: selectedSummary.customerName, icon: UserRound },
                { label: 'สินค้า', value: selectedSummary.productName, icon: Archive },
              ].map((item) => (
                <div key={item.label} className="rounded-xl bg-gray-50 p-3 dark:bg-gray-900/50">
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-500"><item.icon className="h-4 w-4" />{item.label}</div>
                  <p className="mt-1 break-words font-semibold text-gray-900 dark:text-white">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 rounded-xl border border-gray-200 p-4 text-sm dark:border-gray-700 sm:grid-cols-2">
              <div><span className="text-gray-500">ผู้ทำรายการ:</span> <strong>{selectedActor.name}</strong> ({selectedActor.role})</div>
              <div><span className="text-gray-500">สาขา:</span> <strong>{selected.store_name || '-'}</strong> {selected.store_code ? `(${selected.store_code})` : ''}</div>
              <div><span className="text-gray-500">วันเวลา:</span> <strong>{formatThaiDateTime(selected.created_at)}</strong></div>
              <div><span className="text-gray-500">แหล่งข้อมูล:</span> <strong>{selected.table_name || '-'} / {selected.record_id || '-'}</strong></div>
            </div>

            <section>
              <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">รายการเปลี่ยนแปลง</h3>
              {selectedChanges.length === 0 ? (
                <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500 dark:bg-gray-900/50">เหตุการณ์นี้ไม่มีค่าก่อน–หลังที่แตกต่างกัน</p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                  <div className="grid grid-cols-[minmax(100px,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 dark:bg-gray-900/50">
                    <span>ข้อมูล</span><span>ก่อน</span><span>หลัง</span>
                  </div>
                  {selectedChanges.map((change) => (
                    <div key={change.field} className="grid grid-cols-[minmax(100px,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-t border-gray-100 px-3 py-2 text-sm dark:border-gray-700">
                      <span className="break-words font-medium text-gray-700 dark:text-gray-200">{fieldLabel(change.field)}</span>
                      <span className="break-words whitespace-pre-wrap text-gray-500 dark:text-gray-400">{formatValue(change.before)}</span>
                      <span className="break-words whitespace-pre-wrap font-medium text-gray-900 dark:text-white">{formatValue(change.after)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <details className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <summary className="cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-200">ดูข้อมูลดิบสำหรับตรวจสอบ</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-500">ก่อนแก้ไข</p>
                  <pre className="max-h-72 overflow-auto rounded-lg bg-gray-950 p-3 text-xs text-gray-100">{JSON.stringify(selected.old_value, null, 2) || 'null'}</pre>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-500">หลังแก้ไข</p>
                  <pre className="max-h-72 overflow-auto rounded-lg bg-gray-950 p-3 text-xs text-gray-100">{JSON.stringify(selected.new_value, null, 2) || 'null'}</pre>
                </div>
              </div>
            </details>
          </div>
        )}
      </Modal>
    </div>
  );
}
