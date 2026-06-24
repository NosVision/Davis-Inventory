'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Textarea, Select, toast } from '@/components/ui';
import { Archive } from 'lucide-react';
import type { TaskRoom } from '@/types/tasks';

const ICON_OPTIONS = [
  { value: 'clipboard-list', label: 'รายการงาน' },
  { value: 'wrench', label: 'ซ่อม' },
  { value: 'wallet', label: 'บัญชี/การเงิน' },
  { value: 'sparkles', label: 'ความสะอาด' },
  { value: 'megaphone', label: 'การตลาด' },
  { value: 'package', label: 'สต๊อก/คลัง' },
  { value: 'utensils', label: 'ครัว/อาหาร' },
  { value: 'calendar-days', label: 'ปฏิทิน' },
];
const COLOR_OPTIONS = [
  { value: 'indigo', label: 'น้ำเงินม่วง' },
  { value: 'rose', label: 'ชมพู' },
  { value: 'amber', label: 'ส้มเหลือง' },
  { value: 'green', label: 'เขียว' },
  { value: 'sky', label: 'ฟ้า' },
  { value: 'violet', label: 'ม่วง' },
  { value: 'red', label: 'แดง' },
  { value: 'teal', label: 'เขียวน้ำทะเล' },
];

export function RoomSettings({ room, onUpdated }: { room: TaskRoom; onUpdated: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description ?? '');
  const [icon, setIcon] = useState(room.icon);
  const [color, setColor] = useState(room.color);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/rooms/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, icon, color }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
      toast({ type: 'success', title: 'บันทึกแล้ว' });
      onUpdated();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!confirm('เก็บห้องนี้? ห้องจะถูกซ่อนจากทุกคน (ไม่ลบข้อมูล)')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/rooms/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เก็บห้องไม่สำเร็จ');
      toast({ type: 'success', title: 'เก็บห้องแล้ว' });
      router.push('/tasks');
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Input label="ชื่อห้อง" value={name} onChange={(e) => setName(e.target.value)} />
      <Textarea label="คำอธิบาย" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      <div className="grid grid-cols-2 gap-3">
        <Select label="ไอคอน" value={icon} onChange={(e) => setIcon(e.target.value)} options={ICON_OPTIONS} />
        <Select label="สี" value={color} onChange={(e) => setColor(e.target.value)} options={COLOR_OPTIONS} />
      </div>
      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving}>บันทึก</Button>
      </div>

      {!room.is_system && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-900/40 dark:bg-red-900/10">
          <p className="mb-1 text-sm font-medium text-red-700 dark:text-red-400">โซนอันตราย</p>
          <p className="mb-3 text-xs text-red-500">เก็บห้องนี้จะซ่อนห้องจากสมาชิกทั้งหมด (ข้อมูลยังอยู่)</p>
          <Button variant="danger" size="sm" icon={<Archive className="h-4 w-4" />} onClick={archive} disabled={saving}>
            เก็บห้องนี้
          </Button>
        </div>
      )}
    </div>
  );
}
