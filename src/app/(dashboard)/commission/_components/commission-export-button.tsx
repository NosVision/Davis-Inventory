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

interface AEGroup {
  ae_id: string;
  ae_name: string;
  ae_nickname: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  entry_count: number;
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
}

function formatCurrency(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CommissionExportButton({ month: monthProp, allowMonthChange = false }: CommissionExportButtonProps) {
  const { currentStoreId } = useAppStore();

  const [open, setOpen] = useState(false);
  const [exportMonth, setExportMonth] = useState(monthProp);
  const [groups, setGroups] = useState<AEGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [storeName, setStoreName] = useState('');

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
        setSelectedIds(new Set());
        return;
      }
      const json = await res.json();
      const ae = (json.ae_summary as AEGroup[]) || [];
      setGroups(ae);
      setSelectedIds(new Set(ae.map((a) => a.ae_id)));
    } finally {
      setLoadingGroups(false);
    }
  }, [open, exportMonth, currentStoreId]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const allChecked = useMemo(
    () => groups.length > 0 && groups.every((g) => selectedIds.has(g.ae_id)),
    [groups, selectedIds],
  );
  const someChecked = useMemo(
    () => !allChecked && groups.some((g) => selectedIds.has(g.ae_id)),
    [groups, allChecked, selectedIds],
  );
  const pickedTotal = useMemo(
    () => groups.filter((g) => selectedIds.has(g.ae_id)).reduce((s, g) => s + (Number(g.total_net) || 0), 0),
    [groups, selectedIds],
  );

  function toggleAe(aeId: string, next: boolean) {
    setSelectedIds((prev) => {
      const set = new Set(prev);
      if (next) set.add(aeId);
      else set.delete(aeId);
      return set;
    });
  }

  function toggleAll(next: boolean) {
    if (next) setSelectedIds(new Set(groups.map((g) => g.ae_id)));
    else setSelectedIds(new Set());
  }

  async function handleExport() {
    if (selectedIds.size === 0) {
      toast({ type: 'error', title: 'กรุณาเลือกอย่างน้อย 1 AE' });
      return;
    }
    setExporting(true);
    try {
      const mod = await import('./commission-pdf');
      const picked = groups.filter((g) => selectedIds.has(g.ae_id));

      const reportGroups = picked.map((g) => {
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
            net_amount: Number(r.net_amount) || 0,
          };
        });
        const totals = rows.reduce(
          (acc, r) => ({
            subtotal: acc.subtotal + r.subtotal,
            commission: acc.commission + r.commission_amount,
            net: acc.net + r.net_amount,
            bill_count: acc.bill_count + 1,
          }),
          { subtotal: 0, commission: 0, net: 0, bill_count: 0 },
        );
        const bankLabel = g.bank_name
          ? `${g.bank_name} ${g.bank_account_no || ''}${g.bank_account_name ? ` (${g.bank_account_name})` : ''}`.trim()
          : null;
        return {
          ae_name: g.ae_name,
          ae_nickname: g.ae_nickname,
          bank_label: bankLabel,
          rows,
          totals,
        };
      });

      const grand = reportGroups.reduce(
        (acc, g) => ({
          subtotal: acc.subtotal + g.totals.subtotal,
          commission: acc.commission + g.totals.commission,
          net: acc.net + g.totals.net,
          bill_count: acc.bill_count + g.totals.bill_count,
        }),
        { subtotal: 0, commission: 0, net: 0, bill_count: 0 },
      );

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

      const data: import('./commission-pdf').CommissionReportData = {
        store_name: storeName || 'สาขา',
        month_label: monthLabel,
        generated_at_label: generatedAtLabel,
        groups: reportGroups,
        grand,
      };

      const blob = await mod.buildCommissionPdf(data);
      mod.downloadBlob(blob, `รายงานคอมมิชชั่น-${storeName || 'store'}-${exportMonth}.pdf`);
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
        description="เลือก AE ที่ต้องการรวมในรายงาน"
        size="md"
      >
        <div className="space-y-3">
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
          ) : groups.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">ไม่มีข้อมูล AE ในเดือนนี้</p>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 dark:bg-gray-800/50 dark:text-gray-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={(ev) => toggleAll(ev.target.checked)}
                />
                เลือกทั้งหมด ({groups.length} AE)
              </label>
              <div className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg ring-1 ring-gray-200 dark:divide-gray-700 dark:ring-gray-700">
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
              <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
                เลือก {selectedIds.size} AE · ยอดสุทธิรวม {formatCurrency(pickedTotal)} บาท
              </div>
            </>
          )}
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>ยกเลิก</Button>
          <Button
            variant="primary"
            onClick={handleExport}
            disabled={exporting || selectedIds.size === 0 || loadingGroups}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            ดาวน์โหลด PDF
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
