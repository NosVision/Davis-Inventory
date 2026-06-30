'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, ChefHat, Check } from 'lucide-react';
import { Select } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { broadcastToChannel } from '@/lib/supabase/broadcast';

interface Ticket {
  id: string;
  name: string;
  qty: number;
  station: string | null;
  sent_at: string | null;
  note: string | null;
  modifiers: { name: string }[];
  order: { id: string; order_no: number; table_id: string | null; table: { name: string } | null };
}

const STATIONS = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'kitchen', label: 'ครัว' },
  { value: 'bar', label: 'บาร์' },
];

export default function KdsPage() {
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeId, setStoreId] = useState('');
  const [station, setStation] = useState('all');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = createClient();
    sb.from('stores')
      .select('id, store_name')
      .eq('active', true)
      .order('store_name')
      .then(({ data }) => {
        const ss = ((data as { id: string; store_name: string }[]) ?? []).map((s) => ({ id: s.id, name: s.store_name }));
        setStores(ss);
        if (ss[0]) setStoreId(ss[0].id);
      });
  }, []);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/kds?storeId=${storeId}&station=${station}`);
      const d = await res.json();
      if (res.ok) setTickets(d.tickets ?? []);
    } finally {
      setLoading(false);
    }
  }, [storeId, station]);
  useEffect(() => {
    load();
  }, [load]);

  // realtime (Broadcast) — เครื่องขายส่งครัว/ทำเสร็จ → KDS เด้งทันที
  useEffect(() => {
    if (!storeId) return;
    const sb = createClient();
    const ch = sb.channel(`pos:kds:${storeId}`).on('broadcast', { event: 'kds_update' }, () => load()).subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [storeId, load]);

  const markDone = async (ids: string[]) => {
    setTickets((t) => t.filter((x) => !ids.includes(x.id)));
    await fetch('/api/pos/kds/done', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds: ids }) });
    try {
      await broadcastToChannel(createClient(), `pos:kds:${storeId}`, 'kds_update', {});
    } catch {
      // ignore
    }
  };

  const groups = useMemo(() => {
    const m = new Map<string, { order: Ticket['order']; items: Ticket[] }>();
    for (const t of tickets) {
      if (!m.has(t.order.id)) m.set(t.order.id, { order: t.order, items: [] });
      m.get(t.order.id)!.items.push(t);
    }
    return [...m.values()];
  }, [tickets]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href="/pos" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><ArrowLeft className="h-5 w-5" /></Link>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-900/30"><ChefHat className="h-5 w-5" /></span>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">จอครัว (KDS)</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-40"><Select value={station} onChange={(e) => setStation(e.target.value)} options={STATIONS} /></div>
          {stores.length > 1 && <div className="w-44"><Select value={storeId} onChange={(e) => setStoreId(e.target.value)} options={stores.map((s) => ({ value: s.id, label: s.name }))} /></div>}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-amber-500" /></div>
      ) : groups.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">ไม่มีออเดอร์รอทำ 🎉</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {groups.map((g) => (
            <div key={g.order.id} className="flex flex-col rounded-2xl border-2 border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-900/10">
              <div className="flex items-center justify-between border-b border-amber-200 px-3 py-2 dark:border-amber-900/40">
                <span className="font-bold text-gray-900 dark:text-white">{g.order.table?.name ?? 'ขายเร็ว'}</span>
                <span className="font-mono text-xs text-gray-400">#{g.order.order_no}</span>
              </div>
              <ul className="flex-1 space-y-1 p-2">
                {g.items.map((it) => (
                  <li key={it.id} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 dark:bg-gray-800">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-100 text-xs font-bold text-amber-700 dark:bg-amber-900/40">{Number(it.qty)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{it.name}</p>
                      {(it.modifiers?.length > 0 || it.note) && (
                        <p className="truncate text-[10px] text-gray-400">
                          {it.modifiers?.map((m) => m.name).join(', ')}
                          {it.note ? ` · ${it.note}` : ''}
                        </p>
                      )}
                    </div>
                    <button onClick={() => markDone([it.id])} className="rounded-md p-1 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30" title="เสร็จ"><Check className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
              <button onClick={() => markDone(g.items.map((i) => i.id))} className="border-t border-amber-200 px-3 py-2 text-sm font-semibold text-emerald-600 hover:bg-emerald-50 dark:border-amber-900/40 dark:hover:bg-emerald-900/20">
                เสร็จทั้งโต๊ะ
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
