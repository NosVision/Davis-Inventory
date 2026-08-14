'use client';

/**
 * "สินค้าติดลบใน POS" — the rows HQ asked to be able to see (owner ask 2026-08-14).
 *
 * A negative quantity in the POS file means POS sold past zero. Those lines were invisible on
 * every existing screen, and not by accident: excluded products are skipped by the comparison,
 * deactivated products are off the count sheet so they can only appear as POS-only rows, and a
 * date nobody ran the comparison for has no rows at all. See the API route for the full account.
 *
 * Deliberately read-only and outside the explain flow. HQ asked to SEE which products are
 * negative; turning them into pending explanations would put work on staff for stock movements
 * that are months old and, for excluded products, were never theirs to count.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Loader2 } from 'lucide-react';
import { Modal, Badge } from '@/components/ui';
import { formatThaiDate, formatQty } from '@/lib/utils/format';

interface Row {
  date: string;
  product_code: string;
  product_name: string | null;
  qty_ocr: number;
  active: boolean | null;
  count_status: string | null;
  hidden_reason: 'excluded' | 'inactive' | 'not_in_products' | 'no_comparison' | 'visible';
}

const REASON_LABEL: Record<Row['hidden_reason'], string> = {
  excluded: 'ตั้งเป็น "ไม่ต้องนับ"',
  inactive: 'สินค้าปิดใช้งาน',
  not_in_products: 'ไม่มีรหัสนี้ในระบบสินค้า',
  no_comparison: 'ยังไม่ได้กดเปรียบเทียบวันนี้',
  visible: 'อยู่ในตารางเปรียบเทียบแล้ว',
};

const REASON_TONE: Record<Row['hidden_reason'], 'danger' | 'warning' | 'default'> = {
  excluded: 'warning',
  inactive: 'warning',
  not_in_products: 'danger',
  no_comparison: 'danger',
  visible: 'default',
};

interface Props {
  storeId: string;
  /** Empty string means "every date this store has uploaded". */
  date: string;
  /** Only HQ-level roles see this at all. */
  canView: boolean;
}

export function PosNegativesPanel({ storeId, date, canView }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // Tracks whether the current view is the selected day or the whole store history, so the
  // "ดูทั้งหมด" escape hatch can tell the user which one they are looking at.
  const [scope, setScope] = useState<'date' | 'all'>('date');

  const load = useCallback(
    async (wanted: 'date' | 'all') => {
      if (!storeId || !canView) return;
      setLoading(true);
      try {
        const qs = new URLSearchParams({ store_id: storeId });
        if (wanted === 'date' && date) qs.set('date', date);
        const res = await fetch(`/api/stock/pos-negatives?${qs}`);
        const json = await res.json().catch(() => ({}));
        setRows(res.ok ? ((json.data?.rows ?? []) as Row[]) : []);
        setScope(wanted);
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [storeId, date, canView]
  );

  useEffect(() => {
    load('date');
  }, [load]);

  if (!canView) return null;

  // Nothing negative for this day is the normal case, and a green "all clear" banner on every
  // single day would train people to ignore the strip entirely. Stay silent instead — but never
  // while the modal is open, or switching to "ทุกวัน" and finding nothing would unmount the very
  // dialog showing that answer.
  if (!loading && rows.length === 0 && !open) return null;

  const worst = rows.length ? Math.min(...rows.map((r) => r.qty_ocr)) : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-left transition-colors hover:bg-red-100 dark:border-red-800/60 dark:bg-red-900/20 dark:hover:bg-red-900/30"
      >
        <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-900 dark:text-red-200">
            POS ติดลบ {rows.length} รายการ
            {scope === 'all' && ' (ทุกวัน)'}
          </p>
          <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
            POS ขายทะลุศูนย์ — ต่ำสุด {formatQty(worst)} · รายการเหล่านี้ไม่ขึ้นในตารางเปรียบเทียบ
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-red-500" />
      </button>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={`สินค้าติดลบใน POS${scope === 'date' && date ? ` — ${formatThaiDate(date)}` : ' — ทุกวัน'}`}
        size="lg"
      >
        <div className="space-y-3">
          <p className="rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            จำนวนติดลบใน POS แปลว่า <span className="font-semibold">ขายออกไปมากกว่าที่เคยมี</span> ยอดวิ่งผ่านศูนย์ลงไป
            ช่องขวาบอกว่าทำไมรายการนี้ถึงไม่เคยขึ้นในตารางเปรียบเทียบ
          </p>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-7 w-7 animate-spin text-gray-400" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">ไม่พบรายการติดลบ</p>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                  <tr className="text-left text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-2 font-medium">วันที่</th>
                    <th className="px-3 py-2 font-medium">สินค้า</th>
                    <th className="px-3 py-2 text-right font-medium">จำนวน POS</th>
                    <th className="px-3 py-2 font-medium">ทำไมไม่แสดง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                  {rows.map((r) => (
                    <tr key={`${r.date}-${r.product_code}`}>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                        {formatThaiDate(r.date)}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-900 dark:text-white">
                          {r.product_name ?? r.product_code}
                        </p>
                        <p className="text-[11px] text-gray-400">{r.product_code}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-red-600 dark:text-red-400">
                        {formatQty(r.qty_ocr)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={REASON_TONE[r.hidden_reason]} size="sm">
                          {REASON_LABEL[r.hidden_reason]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* A negative that HQ is hunting for is often not on the day they happen to have open —
              the only negatives on record right now are from a single upload months back. */}
          {scope === 'date' && (
            <button
              type="button"
              onClick={() => load('all')}
              className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              ดูทุกวันของสาขานี้ →
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
