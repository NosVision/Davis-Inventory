'use client';

/**
 * Commission Export Button — drop-in download trigger used in both the
 * Pending tab (locked to the current page month) and the History tab
 * (where the accountant might want to grab any past month).
 *
 * Owns its own modal, AE-selection state, summary fetch, and PDF
 * generation so the parent tabs stay thin. Lazy-imports the PDF module
 * on click so the ~600 KB react-pdf bundle stays out of the main
 * route chunk.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Modal, ModalFooter, toast } from '@/components/ui';
import { FileDown, Loader2 } from 'lucide-react';
import { useAppStore } from '@/stores/app-store';
import { createClient } from '@/lib/supabase/client';
import { netDisplay } from '@/types/commission';

interface AEGroup {
  ae_id: string;
  ae_name: string;
  ae_nickname: string | null;
  email?: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  entry_count: number;
  total_net: number;
  entries: Array<Record<string, unknown>>;
}

interface BottleGroup {
  staff_id: string;
  staff_name: string;
  entry_count: number;
  total_bottles: number;
  total_net: number;
  entries: Array<Record<string, unknown>>;
}

interface CommissionExportButtonProps {
  /** Initial month (YYYY-MM). For Pending tab this is fixed; for
   *  History tab the user can change it inside the modal. */
  month: string;
  /** True for History tab — render a month picker inside the modal so
   *  the accountant can pick a past month without leaving the page. */
  allowMonthChange?: boolean;
  /** display-only whole-baht view (entries are stored exact) */
  rounded?: boolean;
}

function formatCurrency(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Keep Thai names but drop what a filesystem (or a zip entry) can't take. */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim() || 'ae';
}

/** 'all' = every selected AE in one report · 'per_ae' = one report per AE (zipped when >1). */
type ExportMode = 'all' | 'per_ae';

export function CommissionExportButton({ month: monthProp, allowMonthChange = false, rounded = false }: CommissionExportButtonProps) {
  const { currentStoreId } = useAppStore();

  const [open, setOpen] = useState(false);
  const [exportMonth, setExportMonth] = useState(monthProp);
  const [groups, setGroups] = useState<AEGroup[]>([]);
  const [bottleGroups, setBottleGroups] = useState<BottleGroup[]>([]);
  const [certs, setCerts] = useState<Record<string, { status: string; note: string | null }>>({});
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedBottleIds, setSelectedBottleIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [mode, setMode] = useState<ExportMode>('all');

  // Reset exportMonth when the parent's month changes (e.g. user navigates
  // to a different month at the page level) so the modal opens on what
  // they last had selected.
  useEffect(() => { setExportMonth(monthProp); }, [monthProp]);

  // Cache the store's display name once per store.
  useEffect(() => {
    if (!currentStoreId) { setStoreName(''); return; }
    const supabase = createClient();
    supabase
      .from('stores')
      .select('store_name')
      .eq('id', currentStoreId)
      .maybeSingle()
      .then(({ data }) => setStoreName((data as { store_name?: string } | null)?.store_name || ''));
  }, [currentStoreId]);

  // Pull the AE summary for the chosen month + store. Re-runs whenever
  // the modal opens or the user picks a different month inside it.
  const fetchGroups = useCallback(async () => {
    if (!open) return;
    setLoadingGroups(true);
    try {
      const params = new URLSearchParams({ month: exportMonth });
      if (currentStoreId) params.set('store_id', currentStoreId);
      const res = await fetch(`/api/commission/summary?${params}`);
      if (!res.ok) {
        setGroups([]);
        setBottleGroups([]);
        setSelectedIds(new Set());
        setSelectedBottleIds(new Set());
        return;
      }
      const json = await res.json();
      const ae = (json.ae_summary as AEGroup[]) || [];
      setGroups(ae);
      setSelectedIds(new Set(ae.map((a) => a.ae_id)));
      // Bottle staff for the same month — the summary API has always returned
      // this alongside ae_summary; the modal just never read it (hence no
      // Bottle PDF from the ค้างจ่าย tab).
      const bottles = (json.bottle_summary as BottleGroup[]) || [];
      setBottleGroups(bottles);
      setSelectedBottleIds(new Set(bottles.map((b) => b.staff_id)));

      // ใบ 50 ทวิ marks for the same month — printed under each AE so the accountant can see
      // who asked without going back to the screen. Best-effort: the PDF is still valid without it.
      const certRes = await fetch(`/api/commission/wht-certs?${params}`);
      if (certRes.ok) {
        const rows = (await certRes.json()) as Array<{ ae_id: string; status: string; note: string | null }>;
        setCerts(Object.fromEntries(rows.map((r) => [r.ae_id, r])));
      } else {
        setCerts({});
      }
    } finally {
      setLoadingGroups(false);
    }
  }, [open, exportMonth, currentStoreId]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const aeAllChecked = useMemo(
    () => groups.length > 0 && groups.every((g) => selectedIds.has(g.ae_id)),
    [groups, selectedIds],
  );
  const aeSomeChecked = useMemo(
    () => !aeAllChecked && groups.some((g) => selectedIds.has(g.ae_id)),
    [groups, aeAllChecked, selectedIds],
  );
  const bottleAllChecked = useMemo(
    () => bottleGroups.length > 0 && bottleGroups.every((g) => selectedBottleIds.has(g.staff_id)),
    [bottleGroups, selectedBottleIds],
  );
  const bottleSomeChecked = useMemo(
    () => !bottleAllChecked && bottleGroups.some((g) => selectedBottleIds.has(g.staff_id)),
    [bottleGroups, bottleAllChecked, selectedBottleIds],
  );
  const pickedCount = selectedIds.size + selectedBottleIds.size;
  const pickedBottles = useMemo(
    () => bottleGroups.filter((g) => selectedBottleIds.has(g.staff_id)).reduce((s, g) => s + (Number(g.total_bottles) || 0), 0),
    [bottleGroups, selectedBottleIds],
  );
  const pickedTotal = useMemo(
    () =>
      groups.filter((g) => selectedIds.has(g.ae_id)).reduce((s, g) => s + (Number(g.total_net) || 0), 0) +
      bottleGroups.filter((g) => selectedBottleIds.has(g.staff_id)).reduce((s, g) => s + (Number(g.total_net) || 0), 0),
    [groups, selectedIds, bottleGroups, selectedBottleIds],
  );

  function toggleAe(aeId: string, next: boolean) {
    setSelectedIds((prev) => {
      const set = new Set(prev);
      if (next) set.add(aeId);
      else set.delete(aeId);
      return set;
    });
  }

  function toggleAllAe(next: boolean) {
    if (next) setSelectedIds(new Set(groups.map((g) => g.ae_id)));
    else setSelectedIds(new Set());
  }

  function toggleBottle(staffId: string, next: boolean) {
    setSelectedBottleIds((prev) => {
      const set = new Set(prev);
      if (next) set.add(staffId);
      else set.delete(staffId);
      return set;
    });
  }

  function toggleAllBottle(next: boolean) {
    if (next) setSelectedBottleIds(new Set(bottleGroups.map((b) => b.staff_id)));
    else setSelectedBottleIds(new Set());
  }

  async function handleExport() {
    if (pickedCount === 0) {
      toast({ type: 'error', title: 'กรุณาเลือกอย่างน้อย 1 คน' });
      return;
    }
    setExporting(true);
    try {
      const mod = await import('./commission-pdf');
      const netOf = (n: number | null | undefined) => netDisplay(n, rounded);
      const picked = groups.filter((g) => selectedIds.has(g.ae_id));

      const aeReportGroups = picked.map((g) => {
        const sortedEntries = [...(g.entries || [])].sort((a, b) => {
          const da = String((a as Record<string, unknown>).bill_date || '');
          const db = String((b as Record<string, unknown>).bill_date || '');
          return da.localeCompare(db);
        });
        const rows = sortedEntries.map((e) => {
          const r = e as Record<string, unknown>;
          return {
            bill_date: String(r.bill_date || ''),
            receipt_no: (r.receipt_no as string | null) ?? null,
            table_no: (r.table_no as string | null) ?? null,
            subtotal: Number(r.subtotal_amount) || 0,
            commission_amount: Number(r.commission_amount) || 0,
            net_amount: netDisplay(r.net_amount as number, rounded),
            notes: (r.notes as string | null) ?? null,
          };
        });
        const totals = rows.reduce(
          (acc, r) => ({
            subtotal: acc.subtotal + r.subtotal,
            commission: acc.commission + r.commission_amount,
            net: acc.net + r.net_amount,
            bill_count: acc.bill_count + 1,
            bottles: 0,
          }),
          { subtotal: 0, commission: 0, net: 0, bill_count: 0, bottles: 0 },
        );
        const bankLabel = g.bank_name
          ? `${g.bank_name} ${g.bank_account_no || ''}${g.bank_account_name ? ` (${g.bank_account_name})` : ''}`.trim()
          : null;
        const cert = certs[g.ae_id]?.status;
        // A standing request counts as asked even with no monthly row (ae_profiles.wht_cert_standing).
        const standing = !!(g as { wht_cert_standing?: boolean }).wht_cert_standing;
        const certLabel =
          cert === 'issued' ? 'ออกให้แล้ว' : cert === 'requested' || standing ? 'ขอแล้ว' : null;
        // Settled portion of this AE's month, for the cover sheet's จ่ายแล้ว / ค้างจ่าย columns.
        const paid = sortedEntries
          .filter((e) => (e as Record<string, unknown>).payment_id)
          .reduce((s, e) => s + netDisplay((e as Record<string, unknown>).net_amount as number, rounded), 0);
        return {
          kind: 'ae' as const,
          ae_name: g.ae_name,
          ae_nickname: g.ae_nickname,
          bank_label: bankLabel,
          email: g.email ?? null,
          note: certs[g.ae_id]?.note ?? null,
          wht_label: certLabel ? `ใบ 50 ทวิ: ${certLabel}` : null,
          cover_wht_label: certLabel,
          paid,
          rows,
          totals,
        };
      });

      // Bottle staff — same settle-from-cover shape, but the bill grid renders
      // รายการ/ขวด/เรท (mapped by the shared helpers in commission-pdf).
      const bottleReportGroups = bottleGroups
        .filter((b) => selectedBottleIds.has(b.staff_id))
        .map((b) => {
          const sortedEntries = [...(b.entries || [])].sort((a, b2) => {
            const da = String((a as Record<string, unknown>).bill_date || '');
            const db = String((b2 as Record<string, unknown>).bill_date || '');
            return da.localeCompare(db);
          });
          const rows = sortedEntries.map((e) => mod.toBottleRow(e, netOf));
          const totals = mod.sumBottleRows(rows);
          const paid = mod.bottlePaid(b.entries || [], netOf);
          return {
            kind: 'bottle' as const,
            ae_name: b.staff_name,
            ae_nickname: null as string | null,
            bank_label: null as string | null,
            email: null,
            note: null,
            wht_label: null as string | null,
            cover_wht_label: null as string | null,
            paid,
            rows,
            totals,
          };
        });

      const reportGroups = [...aeReportGroups, ...bottleReportGroups];

      const [y, m] = exportMonth.split('-').map(Number);
      const monthLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
        month: 'long',
        year: 'numeric',
      }).format(new Date(y, m - 1, 1));

      const generatedAtLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date());

      // One report, whatever it covers: totals are always the sum of the groups actually in it,
      // so a per-AE file's grand total equals that AE's total instead of the whole month's.
      const makeData = (rgs: typeof reportGroups): import('./commission-pdf').CommissionReportData => ({
        store_name: storeName || 'สาขา',
        month_label: monthLabel,
        generated_at_label: generatedAtLabel,
        // Page 1 — the ค้างจ่าย summary the accountant settles from, ahead of the bill detail
        // (owner ask 2026-08-07). Built from the same groups, so the two can never disagree.
        cover: rgs.map((g) => ({
          kind: g.kind,
          ae_name: `${g.ae_name}${g.ae_nickname ? ` (${g.ae_nickname})` : ''}`,
          bill_count: g.totals.bill_count,
          net: g.totals.net,
          paid: g.paid,
          outstanding: g.totals.net - g.paid,
          wht_label: g.cover_wht_label,
          note: g.note,
        })),
        groups: rgs,
        grand: rgs.reduce(
          (acc, g) => ({
            subtotal: acc.subtotal + g.totals.subtotal,
            commission: acc.commission + g.totals.commission,
            net: acc.net + g.totals.net,
            bill_count: acc.bill_count + g.totals.bill_count,
            bottles: acc.bottles + g.totals.bottles,
          }),
          { subtotal: 0, commission: 0, net: 0, bill_count: 0, bottles: 0 },
        ),
      });

      if (mode === 'per_ae') {
        // One PDF per AE / staff member — what the accountant forwards to each of them
        // individually. A single pick downloads bare; several are zipped, because browsers
        // throttle (and users lose track of) a burst of separate downloads.
        const fileFor = (g: (typeof reportGroups)[number]) =>
          `คอมมิชชั่น-${safeFileName(g.ae_nickname || g.ae_name)}-${exportMonth}.pdf`;
        if (reportGroups.length === 1) {
          const blob = await mod.buildCommissionPdf(makeData([reportGroups[0]]));
          mod.downloadBlob(blob, fileFor(reportGroups[0]));
        } else {
          const JSZip = (await import('jszip')).default;
          const zip = new JSZip();
          for (const g of reportGroups) {
            zip.file(fileFor(g), await mod.buildCommissionPdf(makeData([g])));
          }
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          mod.downloadBlob(zipBlob, `คอมมิชชั่นแยกรายคน-${safeFileName(storeName || 'store')}-${exportMonth}.zip`);
        }
      } else {
        const blob = await mod.buildCommissionPdf(makeData(reportGroups));
        mod.downloadBlob(blob, `รายงานคอมมิชชั่น-${storeName || 'store'}-${exportMonth}.pdf`);
      }
      setOpen(false);
    } catch (err) {
      console.error('Commission PDF export error:', err);
      toast({ type: 'error', title: 'สร้าง PDF ล้มเหลว' });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="primary"
        icon={<FileDown className="h-3.5 w-3.5" />}
        onClick={() => setOpen(true)}
      >
        ดาวน์โหลด PDF
      </Button>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="ดาวน์โหลดรายงาน PDF"
        description="เลือก AE / พนักงานที่ต้องการรวมในรายงาน"
        size="md"
      >
        <div className="space-y-3">
          {/* How the selection is split into files. Same data either way — one report holding
              every AE, or one report per AE for forwarding individually. */}
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'all' as const, title: 'รวมเป็นไฟล์เดียว', desc: 'ทุกคนที่เลือกอยู่ในไฟล์เดียว' },
              { id: 'per_ae' as const, title: 'แยกไฟล์รายคน', desc: 'คนละ 1 ไฟล์ · หลายคนดาวน์โหลดเป็น .zip' },
            ]).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMode(opt.id)}
                aria-pressed={mode === opt.id}
                className={`rounded-lg border p-2.5 text-left transition-colors ${
                  mode === opt.id
                    ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-900/20'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                }`}
              >
                <p className={`text-sm font-medium ${mode === opt.id ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-900 dark:text-white'}`}>
                  {opt.title}
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{opt.desc}</p>
              </button>
            ))}
          </div>

          {/* Month picker — only for History tab */}
          {allowMonthChange && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                เดือนที่จะดาวน์โหลด
              </label>
              <input
                type="month"
                value={exportMonth}
                onChange={(e) => setExportMonth(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
          )}

          {loadingGroups ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : groups.length === 0 && bottleGroups.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">ไม่มีข้อมูลในเดือนนี้</p>
          ) : (
            <>
              {groups.length > 0 && (
                <>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 dark:bg-gray-800/50 dark:text-gray-200">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      checked={aeAllChecked}
                      ref={(el) => { if (el) el.indeterminate = aeSomeChecked; }}
                      onChange={(ev) => toggleAllAe(ev.target.checked)}
                    />
                    AE · เลือกทั้งหมด ({groups.length} คน)
                  </label>
                  <div className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg ring-1 ring-gray-200 dark:divide-gray-700 dark:ring-gray-700">
                    {groups.map((g) => {
                      const checked = selectedIds.has(g.ae_id);
                      return (
                        <label
                          key={g.ae_id}
                          className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              checked={checked}
                              onChange={(ev) => toggleAe(g.ae_id, ev.target.checked)}
                            />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-gray-900 dark:text-white">
                                {g.ae_name}
                                {g.ae_nickname ? ` (${g.ae_nickname})` : ''}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {g.entry_count} บิล · {formatCurrency(Number(g.total_net) || 0)} บาท
                              </p>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
              {bottleGroups.length > 0 && (
                <>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-rose-600 focus:ring-rose-500"
                      checked={bottleAllChecked}
                      ref={(el) => { if (el) el.indeterminate = bottleSomeChecked; }}
                      onChange={(ev) => toggleAllBottle(ev.target.checked)}
                    />
                    ค่าคอมขวด · เลือกทั้งหมด ({bottleGroups.length} คน)
                  </label>
                  <div className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg ring-1 ring-gray-200 dark:divide-gray-700 dark:ring-gray-700">
                    {bottleGroups.map((b) => {
                      const checked = selectedBottleIds.has(b.staff_id);
                      return (
                        <label
                          key={b.staff_id}
                          className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 shrink-0 rounded border-gray-300 text-rose-600 focus:ring-rose-500"
                              checked={checked}
                              onChange={(ev) => toggleBottle(b.staff_id, ev.target.checked)}
                            />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-gray-900 dark:text-white">
                                {b.staff_name}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {b.total_bottles} ขวด · {b.entry_count} รายการ · {formatCurrency(Number(b.total_net) || 0)} บาท
                              </p>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
              <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
                เลือก {selectedIds.size} AE · {selectedBottleIds.size} พนักงาน
                {pickedBottles > 0 && ` · ${pickedBottles} ขวด`} · ยอดสุทธิรวม {formatCurrency(pickedTotal)} บาท
                <span className="block text-xs opacity-80">
                  {mode === 'per_ae'
                    ? pickedCount > 1
                      ? `จะได้ ${pickedCount} ไฟล์ (รวมอยู่ใน .zip 1 ไฟล์)`
                      : 'จะได้ 1 ไฟล์'
                    : 'จะได้ 1 ไฟล์ รวมทุกคน'}
                </span>
              </div>
            </>
          )}
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>ยกเลิก</Button>
          <Button
            variant="primary"
            onClick={handleExport}
            disabled={exporting || pickedCount === 0 || loadingGroups}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            {mode === 'per_ae' && pickedCount > 1 ? 'ดาวน์โหลด .zip' : 'ดาวน์โหลด PDF'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
