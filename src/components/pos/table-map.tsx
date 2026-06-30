'use client';

import { useEffect, useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
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

  const tabs = useMemo(() => {
    const list = zones.map((z) => ({ id: z.id, name: z.name }));
    if (tables.some((t) => !t.zone_id)) list.push({ id: 'none', name: 'ไม่ระบุโซน' });
    return list;
  }, [zones, tables]);

  const [activeZone, setActiveZone] = useState(tabs[0]?.id ?? '');
  useEffect(() => {
    if (!tabs.some((t) => t.id === activeZone)) setActiveZone(tabs[0]?.id ?? '');
  }, [tabs, activeZone]);

  const zoneTables = tables.filter((t) => (activeZone === 'none' ? !t.zone_id : t.zone_id === activeZone));
  const placed = zoneTables.filter((t) => t.pos_x != null && t.pos_y != null);
  const unplaced = zoneTables.filter((t) => t.pos_x == null || t.pos_y == null);

  const tokenClass = (busy: boolean) =>
    busy
      ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200'
      : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">แตะโต๊ะเพื่อเปิด/ดูบิล</p>
        <button onClick={onQuickSale} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600">
          <Zap className="h-4 w-4" /> ขายเร็ว
        </button>
      </div>

      {tabs.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">ยังไม่มีโต๊ะในสาขานี้</p>
      ) : (
        <>
          {tabs.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveZone(t.id)}
                  className={`rounded-full px-3 py-1 text-sm font-medium ${activeZone === t.id ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}

          {/* ผังวิชวล (โต๊ะที่จัดตำแหน่งแล้ว) */}
          {placed.length > 0 && (
            <div
              className="relative w-full overflow-hidden rounded-2xl border border-gray-200 bg-[linear-gradient(#f1f4f9_1px,transparent_1px),linear-gradient(90deg,#f1f4f9_1px,transparent_1px)] bg-[size:24px_24px] dark:border-gray-700 dark:bg-gray-900"
              style={{ aspectRatio: '16 / 10' }}
            >
              {placed.map((t) => {
                const order = orderByTable.get(t.id);
                const busy = !!order;
                return (
                  <button
                    key={t.id}
                    onClick={() => onOpenTable(t.id)}
                    className={`absolute flex select-none flex-col items-center justify-center border-2 text-xs font-bold shadow-sm ${tokenClass(busy)} ${t.shape === 'circle' ? 'rounded-full' : 'rounded-lg'}`}
                    style={{ left: `${t.pos_x}%`, top: `${t.pos_y}%`, transform: 'translate(-50%, -50%)', width: t.shape === 'rect' ? 92 : 60, height: 60 }}
                  >
                    <span className="text-sm">{t.name}</span>
                    <span className="font-mono text-[10px] font-normal">{busy ? `฿${formatBaht(order!.total_satang)}` : 'ว่าง'}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* โต๊ะที่ยังไม่จัดตำแหน่ง — แสดงเป็นกริด (ยังกดขายได้) */}
          {unplaced.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {unplaced.map((t) => {
                const order = orderByTable.get(t.id);
                const busy = !!order;
                return (
                  <button key={t.id} onClick={() => onOpenTable(t.id)} className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border-2 p-2 text-center transition ${tokenClass(busy)}`}>
                    <span className="text-base font-bold">{t.name}</span>
                    <span className="font-mono text-[11px] font-normal">{busy ? `฿${formatBaht(order!.total_satang)}` : `ว่าง${t.seats ? ` · ${t.seats} ที่` : ''}`}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
