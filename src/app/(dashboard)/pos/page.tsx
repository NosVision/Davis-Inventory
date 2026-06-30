'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Monitor, LayoutGrid, ListChecks, ChefHat } from 'lucide-react';
import { Select, toast } from '@/components/ui';
import { useAuthStore } from '@/stores/auth-store';
import { useRealtime } from '@/hooks/use-realtime';
import { TableMap } from '@/components/pos/table-map';
import { OrderScreen } from '@/components/pos/order-screen';
import { MenuAvailabilityPanel } from '@/components/pos/menu-availability-panel';
import type { MenuCategory, MenuItem, PosOrder, PosTable, PosZone } from '@/types/pos';

interface Bootstrap {
  stores: { id: string; name: string }[];
  zones: PosZone[];
  tables: PosTable[];
  categories: MenuCategory[];
  items: MenuItem[];
  openOrders: PosOrder[];
  modifierMenuIds: string[];
}

export default function PosPage() {
  const { user } = useAuthStore();
  const [storeId, setStoreId] = useState('');
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [showAvail, setShowAvail] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/bootstrap${storeId ? `?storeId=${storeId}` : ''}`);
      const d = await res.json();
      if (res.ok) {
        setData(d);
        if (!storeId && d.stores?.[0]) setStoreId(d.stores[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  // realtime (CDC) — บิลเปิด/ปิด/ย้ายโต๊ะที่เครื่องอื่น → ผังโต๊ะอัปเดตสด
  useRealtime({
    table: 'pos_orders',
    filter: storeId ? `store_id=eq.${storeId}` : undefined,
    onInsert: load,
    onUpdate: load,
    onDelete: load,
    enabled: !!storeId && !orderId,
  });

  const openTable = async (tableId: string | null) => {
    if (!storeId) return;
    try {
      const res = await fetch('/api/pos/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, tableId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'เปิดบิลไม่สำเร็จ');
      setOrderId(d.order.id);
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    }
  };

  if (loading && !data) {
    return <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-indigo-500" /></div>;
  }

  return (
    <div className="space-y-4">
      {!orderId && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30">
              <Monitor className="h-5 w-5" />
            </span>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">หน้าขาย (POS)</h1>
          </div>
          <div className="flex items-center gap-2">
            {data && data.stores.length > 1 && (
              <div className="w-44">
                <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} options={data.stores.map((s) => ({ value: s.id, label: s.name }))} />
              </div>
            )}
            <button onClick={() => setShowAvail(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">
              <ListChecks className="h-4 w-4" /> ความพร้อม
            </button>
            <Link href="/pos/kds" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">
              <ChefHat className="h-4 w-4" /> จอครัว
            </Link>
            {['owner', 'manager'].includes(user?.role ?? '') && (
              <Link href="/pos/manage" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">
                <LayoutGrid className="h-4 w-4" /> ตั้งค่าผัง
              </Link>
            )}
          </div>
        </div>
      )}

      {data && orderId ? (
        <OrderScreen
          orderId={orderId}
          storeId={storeId}
          categories={data.categories}
          items={data.items}
          modifierMenuIds={data.modifierMenuIds}
          onBack={() => {
            setOrderId(null);
            load();
          }}
        />
      ) : data ? (
        <TableMap
          zones={data.zones}
          tables={data.tables}
          openOrders={data.openOrders}
          onOpenTable={openTable}
          onQuickSale={() => openTable(null)}
        />
      ) : null}

      {showAvail && storeId && (
        <MenuAvailabilityPanel storeId={storeId} onClose={() => { setShowAvail(false); load(); }} />
      )}
    </div>
  );
}
