'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Repeat, Plus, Trash2, Loader2, Power } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Textarea,
  Select,
  Badge,
  EmptyState,
  Modal,
  ModalFooter,
  toast,
} from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import type { MaintenanceSchedule, MaintenanceIntervalUnit, Store } from '@/types/database';

const UNIT_LABELS: Record<MaintenanceIntervalUnit, string> = {
  day: 'วัน',
  week: 'สัปดาห์',
  month: 'เดือน',
};

const ALL_STORES = '__all__';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function MaintenanceSchedulesPage() {
  const { user } = useAuthStore();
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);
  const [stores, setStores] = useState<Pick<Store, 'id' | 'store_name'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // form
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<string>(ALL_STORES);
  const [intervalCount, setIntervalCount] = useState('1');
  const [intervalUnit, setIntervalUnit] = useState<MaintenanceIntervalUnit>('month');
  const [startDate, setStartDate] = useState(todayStr());

  const isOwner = user?.role === 'owner' || user?.role === 'accountant';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const [schedRes, storeRes] = await Promise.all([
        supabase.from('maintenance_schedules').select('*').order('created_at', { ascending: false }),
        supabase.from('stores').select('id, store_name').eq('active', true).order('store_name'),
      ]);
      setSchedules((schedRes.data as MaintenanceSchedule[]) ?? []);
      setStores((storeRes.data as Pick<Store, 'id' | 'store_name'>[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const storeNameById = useMemo(() => {
    const m = new Map<string, string>();
    stores.forEach((s) => m.set(s.id, s.store_name));
    return m;
  }, [stores]);

  function resetForm() {
    setTitle('');
    setDescription('');
    setScope(ALL_STORES);
    setIntervalCount('1');
    setIntervalUnit('month');
    setStartDate(todayStr());
  }

  async function handleCreate() {
    if (!title.trim()) {
      toast({ type: 'error', title: 'กรุณาระบุชื่องาน' });
      return;
    }
    const count = parseInt(intervalCount, 10);
    if (!count || count < 1) {
      toast({ type: 'error', title: 'รอบต้องมากกว่า 0' });
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('maintenance_schedules').insert({
        store_id: scope === ALL_STORES ? null : scope,
        title: title.trim(),
        description: description.trim() || null,
        interval_unit: intervalUnit,
        interval_count: count,
        start_date: startDate,
        created_by: user?.id ?? null,
      });
      if (error) throw new Error(error.message);
      // Generate occurrences immediately so they show on the calendar.
      await supabase.rpc('generate_maintenance_occurrences');
      toast({ type: 'success', title: 'สร้างงานประจำเรียบร้อย' });
      setOpen(false);
      resetForm();
      await load();
    } catch (err) {
      toast({
        type: 'error',
        title: 'เกิดข้อผิดพลาด',
        message: err instanceof Error ? err.message : 'สร้างไม่สำเร็จ',
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(s: MaintenanceSchedule) {
    const supabase = createClient();
    const { error } = await supabase
      .from('maintenance_schedules')
      .update({ active: !s.active })
      .eq('id', s.id);
    if (error) {
      toast({ type: 'error', title: 'อัปเดตไม่สำเร็จ' });
      return;
    }
    if (!s.active) await supabase.rpc('generate_maintenance_occurrences');
    await load();
  }

  async function remove(s: MaintenanceSchedule) {
    if (!confirm(`ลบงานประจำ "${s.title}" และรายการที่ยังไม่เสร็จทั้งหมด?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from('maintenance_schedules').delete().eq('id', s.id);
    if (error) {
      toast({ type: 'error', title: 'ลบไม่สำเร็จ' });
      return;
    }
    toast({ type: 'success', title: 'ลบเรียบร้อย' });
    await load();
  }

  if (!isOwner) {
    return <EmptyState icon={Repeat} title="ไม่มีสิทธิ์เข้าถึง" description="เฉพาะเจ้าของร้านเท่านั้น" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white">
          <Repeat className="h-5 w-5 text-teal-500" />
          งานประจำของช่าง
        </h1>
        <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
          สร้างงานประจำ
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : schedules.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="ยังไม่มีงานประจำ"
          description="เช่น ฉีดยากันมดทุกเดือน, ล้างแอร์ทุก 2 เดือน"
        />
      ) : (
        <div className="space-y-2">
          {schedules.map((s) => (
            <Card key={s.id} padding="none">
              <div className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-gray-900 dark:text-white">{s.title}</p>
                    {!s.active && <Badge variant="default" size="sm">ปิดใช้งาน</Badge>}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    ทุก {s.interval_count} {UNIT_LABELS[s.interval_unit]} ·{' '}
                    {s.store_id ? storeNameById.get(s.store_id) ?? 'สาขา' : 'ทุกสาขา'} · เริ่ม{' '}
                    {new Date(s.start_date + 'T00:00:00').toLocaleDateString('th-TH', {
                      day: 'numeric',
                      month: 'short',
                      year: '2-digit',
                    })}
                  </p>
                  {s.description && (
                    <p className="mt-0.5 truncate text-xs text-gray-400">{s.description}</p>
                  )}
                </div>
                <button
                  onClick={() => toggleActive(s)}
                  title={s.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.active ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                  <Power className="h-4 w-4" />
                </button>
                <button
                  onClick={() => remove(s)}
                  title="ลบ"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={open} onClose={() => setOpen(false)} title="สร้างงานประจำ" size="md">
        <div className="space-y-3">
          <Input
            label="ชื่องาน"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="เช่น ล้างแอร์"
          />
          <Textarea
            label="รายละเอียด"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Select
            label="ขอบเขตสาขา"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            options={[
              { value: ALL_STORES, label: 'ทุกสาขา' },
              ...stores.map((s) => ({ value: s.id, label: s.store_name })),
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="ทุก ๆ"
              type="number"
              inputMode="numeric"
              value={intervalCount}
              onChange={(e) => setIntervalCount(e.target.value)}
            />
            <Select
              label="หน่วย"
              value={intervalUnit}
              onChange={(e) => setIntervalUnit(e.target.value as MaintenanceIntervalUnit)}
              options={[
                { value: 'day', label: 'วัน' },
                { value: 'week', label: 'สัปดาห์' },
                { value: 'month', label: 'เดือน' },
              ]}
            />
          </div>
          <Input
            label="เริ่มตั้งแต่วันที่"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>ยกเลิก</Button>
          <Button variant="primary" isLoading={saving} onClick={handleCreate}>
            สร้าง
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
