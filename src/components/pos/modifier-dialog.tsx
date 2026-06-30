'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, Modal, ModalFooter, toast } from '@/components/ui';
import { formatBaht } from '@/lib/pos/money';
import type { ModifierGroupWithOptions, PosModifierOption } from '@/types/pos';

interface Props {
  menuItemId: string;
  menuName: string;
  basePriceSatang: number;
  onClose: () => void;
  onConfirm: (optionIds: string[]) => void;
}

export function ModifierDialog({ menuItemId, menuName, basePriceSatang, onClose, onConfirm }: Props) {
  const [groups, setGroups] = useState<ModifierGroupWithOptions[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Record<string, string[]>>({});

  useEffect(() => {
    fetch(`/api/pos/menu-items/${menuItemId}/modifiers`)
      .then((r) => r.json())
      .then((d) => {
        setGroups(d.groups ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [menuItemId]);

  const toggle = (g: ModifierGroupWithOptions, oid: string) => {
    setSel((s) => {
      const cur = s[g.id] ?? [];
      if (g.max_select <= 1) return { ...s, [g.id]: cur.includes(oid) ? [] : [oid] };
      if (cur.includes(oid)) return { ...s, [g.id]: cur.filter((x) => x !== oid) };
      if (cur.length >= g.max_select) return s;
      return { ...s, [g.id]: [...cur, oid] };
    });
  };

  const optMap = useMemo(() => {
    const m = new Map<string, PosModifierOption>();
    groups.forEach((g) => (g.options ?? []).forEach((o) => m.set(o.id, o)));
    return m;
  }, [groups]);

  const allOptionIds = Object.values(sel).flat();
  const delta = allOptionIds.reduce((s, id) => s + (optMap.get(id)?.price_satang ?? 0), 0);
  const total = basePriceSatang + delta;
  const valid = groups.every((g) => !g.required || (sel[g.id]?.length ?? 0) >= Math.max(1, g.min_select));

  const confirm = () => {
    if (!valid) return toast({ type: 'error', title: 'กรุณาเลือกตัวเลือกที่บังคับ' });
    onConfirm(allOptionIds);
  };

  return (
    <Modal isOpen onClose={onClose} title={menuName} size="md">
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
      ) : groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">เมนูนี้ไม่มีตัวเลือก</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.id}>
              <p className="mb-1 text-sm font-semibold text-gray-800 dark:text-gray-100">
                {g.name}
                <span className="ml-1 text-xs font-normal text-gray-400">
                  {g.max_select <= 1 ? '(เลือก 1)' : `(ได้ถึง ${g.max_select})`}
                  {g.required ? ' · บังคับ' : ''}
                </span>
              </p>
              <div className="space-y-1">
                {(g.options ?? []).filter((o) => o.active).map((o) => {
                  const on = (sel[g.id] ?? []).includes(o.id);
                  return (
                    <button
                      key={o.id}
                      onClick={() => toggle(g, o.id)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm ${on ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-900/30' : 'border-gray-200 dark:border-gray-700'}`}
                    >
                      <span className="text-gray-800 dark:text-gray-200">{o.name}</span>
                      <span className="flex items-center gap-2">
                        {o.price_satang > 0 && <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400">+฿{formatBaht(o.price_satang)}</span>}
                        <span className={`flex h-4 w-4 items-center justify-center border text-[10px] ${g.max_select <= 1 ? 'rounded-full' : 'rounded-md'} ${on ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}>{on ? '✓' : ''}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={confirm} disabled={loading}>เพิ่มลงบิล ฿{formatBaht(total)}</Button>
      </ModalFooter>
    </Modal>
  );
}
