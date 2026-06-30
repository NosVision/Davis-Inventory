'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Modal, ModalFooter, Button, Input } from '@/components/ui';
import type { MenuItem } from '@/types/pos';

// เปิด-ปิดเมนู (86) + ตั้งโควตา/วัน — พนักงานในสาขาใช้ได้ (ไม่ต้องเป็นผู้จัดการ)
export function MenuAvailabilityPanel({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch(`/api/pos/menu-items?storeId=${storeId}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(((d.items as MenuItem[]) ?? []).filter((m) => m.active));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [storeId]);

  const patch = async (m: MenuItem, body: Record<string, unknown>, optimistic: Partial<MenuItem>) => {
    setItems((its) => its.map((i) => (i.id === m.id ? { ...i, ...optimistic } : i)));
    await fetch(`/api/pos/menu-items/${m.id}/availability`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  };

  const ql = q.trim().toLowerCase();
  const filtered = items.filter((m) => !ql || m.name.toLowerCase().includes(ql));

  return (
    <Modal isOpen onClose={onClose} title="ความพร้อมขายวันนี้ (เปิด-ปิด / โควตา)" size="md">
      <div className="space-y-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเมนู" leftIcon={<Search className="h-4 w-4" />} />
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
        ) : (
          <div className="max-h-[55vh] space-y-1 overflow-y-auto">
            {filtered.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-white">{m.name}</span>
                <input
                  type="number"
                  min="0"
                  value={m.daily_limit ?? ''}
                  onChange={(e) => patch(m, { dailyLimit: e.target.value ? Number(e.target.value) : null }, { daily_limit: e.target.value ? Number(e.target.value) : null })}
                  placeholder="โควตา"
                  className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm dark:border-gray-600 dark:bg-gray-900"
                />
                <button
                  onClick={() => patch(m, { available: !m.available }, { available: !m.available })}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${m.available ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}
                >
                  {m.available ? 'เปิดขาย' : 'หมด/ปิด'}
                </button>
              </div>
            ))}
            {filtered.length === 0 && <p className="py-8 text-center text-sm text-gray-400">ไม่พบเมนู</p>}
          </div>
        )}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ปิด</Button>
      </ModalFooter>
    </Modal>
  );
}
