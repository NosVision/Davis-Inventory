'use client';

import { useMemo } from 'react';
import { Zap, Armchair } from 'lucide-react';
import { formatBaht } from '@/lib/pos/money';
import type { PosOrder, PosTable, PosZone } from '@/types/pos';

interface Props {
  zones: PosZone[];
  tables: PosTable[];
  openOrders: PosOrder[];
  onOpenTable: (tableId: string) => void;
  onQuickSale: () => void;
}

export function TableMap({ zones, tables, openOrders, onOpenTable, onQuickSale }: Props) {
  const orderByTable = useMemo(() => {
    const m = new Map<string, PosOrder>();
    for (const o of openOrders) if (o.table_id) m.set(o.table_id, o);
    return m;
  }, [openOrders]);

  const zoneList = useMemo(() => {
    const noZone = tables.filter((t) => !t.zone_id);
    const grouped = zones.map((z) => ({ zone: z, items: tables.filter((t) => t.zone_id === z.id) }));
    if (noZone.length) grouped.push({ zone: { id: '_none', name: 'ไม่ระบุโซน' } as PosZone, items: noZone });
    return grouped.filter((g) => g.items.length > 0);
  }, [zones, tables]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">แตะโต๊ะเพื่อเปิด/ดูบิล</p>
        <button
          onClick={onQuickSale}
          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600"
        >
          <Zap className="h-4 w-4" /> ขายเร็ว (ไม่ระบุโต๊ะ)
        </button>
      </div>

      {zoneList.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">ยังไม่มีโต๊ะในสาขานี้</p>
      ) : (
        zoneList.map(({ zone, items }) => (
          <div key={zone.id} className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300">{zone.name}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {items.map((t) => {
                const order = orderByTable.get(t.id);
                const busy = !!order;
                return (
                  <button
                    key={t.id}
                    onClick={() => onOpenTable(t.id)}
                    className={[
                      'flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border-2 p-2 text-center transition',
                      busy
                        ? 'border-rose-300 bg-rose-50 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-900/20'
                        : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20',
                    ].join(' ')}
                  >
                    <Armchair className={`h-5 w-5 ${busy ? 'text-rose-500' : 'text-emerald-500'}`} />
                    <span className="text-base font-bold text-gray-900 dark:text-white">{t.name}</span>
                    {busy ? (
                      <span className="font-mono text-xs font-semibold text-rose-600 dark:text-rose-300">฿{formatBaht(order!.total_satang)}</span>
                    ) : (
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400">ว่าง{t.seats ? ` · ${t.seats} ที่` : ''}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
