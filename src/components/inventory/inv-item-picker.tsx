'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
import { Input } from '@/components/ui';
import type { InvProduct } from '@/types/inventory';

export interface ItemLine {
  productId: string;
  name: string;
  sku: string;
  unit: string | null;
  qty: string;
  cost?: string; // บาท/หน่วย (เฉพาะ PO)
}

interface Props {
  value: ItemLine[];
  onChange: (lines: ItemLine[]) => void;
  showCost?: boolean;
  qtyLabel?: string;
}

// ตัวเพิ่ม/แก้รายการสินค้าจากแคตตาล็อก master ใช้ร่วมกันทั้งใบเบิก/ใบสั่งซื้อ
export function InvItemPicker({ value, onChange, showCost = false }: Props) {
  const [all, setAll] = useState<InvProduct[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch('/api/inventory/products?active=1')
      .then((r) => r.json())
      .then((d) => setAll(d.products ?? []))
      .catch(() => {});
  }, []);

  const chosen = useMemo(() => new Set(value.map((v) => v.productId)), [value]);
  const ql = q.trim().toLowerCase();
  const results = ql
    ? all.filter((p) => !chosen.has(p.id) && `${p.name} ${p.sku}`.toLowerCase().includes(ql)).slice(0, 8)
    : [];

  const add = (p: InvProduct) => {
    onChange([...value, { productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty: '1', cost: '' }]);
    setQ('');
  };
  const upd = (i: number, patch: Partial<ItemLine>) => onChange(value.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const rm = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาสินค้าเพื่อเพิ่มรายการ" leftIcon={<Search className="h-4 w-4" />} />
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
            {results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => add(p)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <Plus className="h-3.5 w-3.5 text-emerald-500" />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="font-mono text-[10px] text-gray-400">{p.sku}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {value.length === 0 ? (
        <p className="text-xs text-gray-400">ยังไม่มีรายการ — ค้นหาด้านบนเพื่อเพิ่ม</p>
      ) : (
        <div className="space-y-1.5">
          {value.map((l, i) => (
            <div key={l.productId} className="flex items-center gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{l.name}</p>
                <p className="font-mono text-[10px] text-gray-400">{l.sku}</p>
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={l.qty}
                onChange={(e) => upd(i, { qty: e.target.value })}
                className="w-16 rounded-md border border-gray-300 px-2 py-1 text-right text-sm dark:border-gray-600 dark:bg-gray-900"
                placeholder="จำนวน"
              />
              <span className="w-7 shrink-0 text-xs text-gray-400">{l.unit ?? ''}</span>
              {showCost && (
                <input
                  type="text"
                  inputMode="decimal"
                  value={l.cost ?? ''}
                  onChange={(e) => upd(i, { cost: e.target.value })}
                  className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm dark:border-gray-600 dark:bg-gray-900"
                  placeholder="ทุน/หน่วย"
                />
              )}
              <button type="button" onClick={() => rm(i)} className="text-gray-400 hover:text-rose-500" title="ลบ">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
