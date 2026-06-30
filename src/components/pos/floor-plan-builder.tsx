'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Loader2, Trash2, X } from 'lucide-react';
import { Button, Input, Select, Modal, ModalFooter, toast } from '@/components/ui';
import type { PosTable, PosZone } from '@/types/pos';

const clamp = (n: number) => Math.max(2, Math.min(98, n));

const SHAPE_OPTIONS = [
  { value: 'square', label: 'สี่เหลี่ยม' },
  { value: 'circle', label: 'กลม' },
  { value: 'rect', label: 'ยาว' },
];

export function FloorPlanBuilder({ storeId, isManager }: { storeId: string; isManager: boolean }) {
  const [zones, setZones] = useState<PosZone[]>([]);
  const [tables, setTables] = useState<PosTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeZone, setActiveZone] = useState('');
  const [editTable, setEditTable] = useState<PosTable | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [zr, tr] = await Promise.all([
        fetch(`/api/pos/zones?storeId=${storeId}`).then((r) => r.json()),
        fetch(`/api/pos/tables?storeId=${storeId}`).then((r) => r.json()),
      ]);
      const zs: PosZone[] = zr.zones ?? [];
      setZones(zs);
      setTables(tr.tables ?? []);
      setActiveZone((prev) => (prev && zs.some((z) => z.id === prev) ? prev : zs[0]?.id ?? ''));
    } finally {
      setLoading(false);
    }
  }, [storeId]);
  useEffect(() => {
    load();
  }, [load]);

  const patchTable = async (id: string, patch: Record<string, unknown>, optimistic?: Partial<PosTable>) => {
    if (optimistic) setTables((ts) => ts.map((t) => (t.id === id ? { ...t, ...optimistic } : t)));
    const res = await fetch(`/api/pos/tables/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!res.ok) toast({ type: 'error', title: 'บันทึกไม่สำเร็จ' });
  };

  const addZone = async () => {
    const name = window.prompt('ชื่อชั้น/โซน (เช่น ชั้น 1, ชั้น 2, ระเบียง)')?.trim();
    if (!name) return;
    const res = await fetch('/api/pos/zones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId, name }) });
    const d = await res.json();
    if (res.ok) {
      setZones((z) => [...z, d.zone]);
      setActiveZone(d.zone.id);
    } else toast({ type: 'error', title: 'ผิดพลาด', message: d.error });
  };

  const deleteZone = async () => {
    if (!activeZone || !window.confirm('ลบชั้น/โซนนี้? (โต๊ะในโซนจะไม่ถูกลบ แต่จะหลุดออกจากโซน)')) return;
    await fetch(`/api/pos/zones/${activeZone}`, { method: 'DELETE' });
    load();
  };

  const addTable = async () => {
    if (!activeZone) return toast({ type: 'error', title: 'เพิ่มชั้น/โซนก่อน' });
    const name = window.prompt('ชื่อโต๊ะ (เช่น A1)')?.trim();
    if (!name) return;
    const res = await fetch('/api/pos/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, zoneId: activeZone, name, posX: 50, posY: 50 }),
    });
    const d = await res.json();
    if (res.ok) setTables((t) => [...t, d.table]);
    else toast({ type: 'error', title: 'ผิดพลาด', message: d.error });
  };

  // ลากโต๊ะบนผัง (pointer) — ขยับ=ย้ายตำแหน่ง, ไม่ขยับ=เปิดแก้ไข
  const onPointerDown = (e: React.PointerEvent, t: PosTable) => {
    if (!isManager) return;
    e.preventDefault();
    let moved = false;
    let lastX = t.pos_x ?? 50;
    let lastY = t.pos_y ?? 50;
    const move = (ev: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      lastX = clamp(((ev.clientX - rect.left) / rect.width) * 100);
      lastY = clamp(((ev.clientY - rect.top) / rect.height) * 100);
      moved = true;
      setTables((ts) => ts.map((tb) => (tb.id === t.id ? { ...tb, pos_x: lastX, pos_y: lastY } : tb)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) patchTable(t.id, { posX: Math.round(lastX * 10) / 10, posY: Math.round(lastY * 10) / 10 });
      else setEditTable(t);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>;

  const zoneTables = tables.filter((t) => t.zone_id === activeZone);
  const placed = zoneTables.filter((t) => t.pos_x != null && t.pos_y != null);
  const unplaced = zoneTables.filter((t) => t.pos_x == null || t.pos_y == null);

  return (
    <div className="space-y-3">
      {/* แท็บชั้น/โซน */}
      <div className="flex flex-wrap items-center gap-1.5">
        {zones.map((z) => (
          <button
            key={z.id}
            onClick={() => setActiveZone(z.id)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${activeZone === z.id ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'}`}
          >
            {z.name}
          </button>
        ))}
        {isManager && (
          <button onClick={addZone} className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 py-1 text-sm text-gray-500 hover:bg-gray-50 dark:border-gray-600">
            <Plus className="h-3.5 w-3.5" /> เพิ่มชั้น/โซน
          </button>
        )}
      </div>

      {zones.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">ยังไม่มีชั้น/โซน — กด "เพิ่มชั้น/โซน"</p>
      ) : (
        <>
          {isManager && (
            <div className="flex items-center gap-2">
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={addTable}>เพิ่มโต๊ะ</Button>
              <Button size="sm" variant="ghost" onClick={deleteZone}>ลบชั้น/โซนนี้</Button>
              <span className="ml-auto text-xs text-gray-400">ลากโต๊ะเพื่อจัดตำแหน่ง · แตะโต๊ะเพื่อแก้ไข</span>
            </div>
          )}

          {/* ผังโต๊ะ (ลากวาง) */}
          <div
            ref={canvasRef}
            className="relative w-full overflow-hidden rounded-2xl border border-gray-200 bg-[linear-gradient(#eef1f6_1px,transparent_1px),linear-gradient(90deg,#eef1f6_1px,transparent_1px)] bg-[size:24px_24px] dark:border-gray-700 dark:bg-gray-900"
            style={{ aspectRatio: '16 / 10', touchAction: 'none' }}
          >
            {placed.map((t) => (
              <button
                key={t.id}
                onPointerDown={(e) => onPointerDown(e, t)}
                className={`absolute flex select-none items-center justify-center border-2 border-indigo-300 bg-white text-sm font-bold text-gray-800 shadow-sm dark:bg-gray-800 dark:text-white ${
                  t.shape === 'circle' ? 'rounded-full' : t.shape === 'rect' ? 'rounded-lg' : 'rounded-lg'
                } ${isManager ? 'cursor-move' : ''}`}
                style={{
                  left: `${t.pos_x}%`,
                  top: `${t.pos_y}%`,
                  transform: 'translate(-50%, -50%)',
                  width: t.shape === 'rect' ? 88 : 56,
                  height: 56,
                }}
              >
                {t.name}
              </button>
            ))}
            {placed.length === 0 && unplaced.length === 0 && (
              <span className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">กด "เพิ่มโต๊ะ" แล้วลากมาวางบนผัง</span>
            )}
          </div>

          {/* โต๊ะที่ยังไม่วาง */}
          {unplaced.length > 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 p-3 dark:border-gray-700">
              <p className="mb-2 text-xs text-gray-400">ยังไม่ได้วาง (แตะเพื่อวางกลางผัง แล้วลากจัดตำแหน่ง)</p>
              <div className="flex flex-wrap gap-2">
                {unplaced.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => isManager && patchTable(t.id, { posX: 50, posY: 50 }, { pos_x: 50, pos_y: 50 })}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {editTable && (
        <EditTableModal table={editTable} onClose={() => setEditTable(null)} onChanged={() => { setEditTable(null); load(); }} />
      )}
    </div>
  );
}

function EditTableModal({ table, onClose, onChanged }: { table: PosTable; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(table.name);
  const [seats, setSeats] = useState(table.seats != null ? String(table.seats) : '');
  const [shape, setShape] = useState(table.shape || 'square');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/pos/tables/${table.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), seats: seats ? Number(seats) : null, shape }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'บันทึกไม่สำเร็จ');
      onChanged();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!window.confirm(`ลบโต๊ะ ${table.name}?`)) return;
    await fetch(`/api/pos/tables/${table.id}`, { method: 'DELETE' });
    onChanged();
  };

  return (
    <Modal isOpen onClose={onClose} title={`โต๊ะ ${table.name}`} size="sm">
      <div className="space-y-3">
        <Input label="ชื่อโต๊ะ" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="ที่นั่ง" value={seats} onChange={(e) => setSeats(e.target.value)} inputMode="numeric" placeholder="—" />
          <Select label="รูปทรง" value={shape} onChange={(e) => setShape(e.target.value)} options={SHAPE_OPTIONS} />
        </div>
        <button onClick={del} className="inline-flex items-center gap-1 text-sm text-rose-500 hover:underline">
          <Trash2 className="h-4 w-4" /> ลบโต๊ะนี้
        </button>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={save} isLoading={saving}>บันทึก</Button>
      </ModalFooter>
    </Modal>
  );
}
