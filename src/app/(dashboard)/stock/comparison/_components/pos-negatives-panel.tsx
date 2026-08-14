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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, History, Loader2 } from 'lucide-react';
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
  /** The day the page has open. Rows are split against it, not fetched by it. */
  date: string;
  /** Only HQ-level roles see this at all. */
  canView: boolean;
}

export function PosNegativesPanel({ storeId, date, canView }: Props) {
  // Fetched once for the whole store, then split by date locally.
  //
  // Fetching per-day was the obvious shape and the wrong one: the negatives HQ is hunting are
  // almost never on the day they happen to have open — the only ones on record are a single
  // upload from three months ago — so a day-scoped fetch would render nothing, and the escape
  // hatch to look wider would be inside the panel that just decided not to draw itself. The whole
  // history is 30 rows.
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<null | 'date' | 'all'>(null);

  const load = useCallback(async () => {
    if (!storeId || !canView) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/stock/pos-negatives?store_id=${storeId}`);
      const json = await res.json().catch(() => ({}));
      setRows(res.ok ? ((json.data?.rows ?? []) as Row[]) : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [storeId, canView]);

  useEffect(() => {
    load();
  }, [load]);

  const forDate = useMemo(() => rows.filter((r) => r.date === date), [rows, date]);
  const shown = open === 'date' ? forDate : rows;

  if (!canView || loading || rows.length === 0) return null;

  // Headline the worst COUNTABLE shortfall, not the worst number. Products marked "ไม่ต้องนับ" are
  // soft drinks and the like, whose POS figures are not stock counts at all — quoting Coke at
  // -217,865 would make the banner read as a catastrophe every single day and teach everyone to
  // scroll past it, hiding the -46.80 bottle it exists to surface.
  const countable = forDate.filter((r) => r.count_status !== 'excluded');
  const headline = countable.length ? countable : forDate;
  const worst = headline.length ? Math.min(...headline.map((r) => r.qty_ocr)) : 0;

  return (
    <>
      {forDate.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen('date')}
          className="flex w-full items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-left transition-colors hover:bg-red-100 dark:border-red-800/60 dark:bg-red-900/20 dark:hover:bg-red-900/30"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-red-900 dark:text-red-200">
              POS ติดลบ {forDate.length} รายการ
              {countable.length > 0 && countable.length < forDate.length && (
                <span className="font-normal"> (สินค้าที่ต้องนับ {countable.length})</span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
              POS ขายทะลุศูนย์ — ต่ำสุด {formatQty(worst)} · รายการเหล่านี้ไม่ขึ้นในตารางเปรียบเทียบ
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-red-500" />
        </button>
      ) : (
        /* The selected day is clean but the store is not. Kept quiet — this is a pointer to
           history, not an alarm about today — yet always present, because otherwise the only way
           to reach months-old negatives would be to already know which day to open. */
        <button
          type="button"
          onClick={() => setOpen('all')}
          className="flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:bg-gray-800"
        >
          <History className="h-4 w-4 shrink-0 text-gray-400" />
          <p className="min-w-0 flex-1 text-xs text-gray-600 dark:text-gray-300">
            วันนี้ไม่มี POS ติดลบ — แต่สาขานี้เคยมี{' '}
            <span className="font-semibold">{rows.length} รายการ</span> ในวันอื่น
          </p>
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
        </button>
      )}

      <Modal
        isOpen={open !== null}
        onClose={() => setOpen(null)}
        title={
          open === 'date' && date
            ? `สินค้าติดลบใน POS — ${formatThaiDate(date)}`
            : 'สินค้าติดลบใน POS — ทุกวันของสาขานี้'
        }
        size="lg"
      >
        <div className="space-y-3">
          <p className="rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            จำนวนติดลบใน POS แปลว่า <span className="font-semibold">ขายออกไปมากกว่าที่เคยมี</span> ยอดวิ่งผ่านศูนย์ลงไป
            ช่องขวาบอกว่าทำไมรายการนี้ถึงไม่เคยขึ้นในตารางเปรียบเทียบ
          </p>

          {shown.length === 0 ? (
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
                  {shown.map((r) => (
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

          {open === 'date' && rows.length > forDate.length && (
            <button
              type="button"
              onClick={() => setOpen('all')}
              className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              ดูทุกวันของสาขานี้ ({rows.length} รายการ) →
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
