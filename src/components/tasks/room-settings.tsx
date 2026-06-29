'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Textarea, Select, toast } from '@/components/ui';
import { Archive } from 'lucide-react';
import { TargetPicker } from './target-picker';
import {
  ICON_OPTIONS,
  COLOR_OPTIONS,
  ASSIGN_MODE_OPTIONS,
  RESPONSE_TYPE_OPTIONS,
} from '@/lib/tasks/room-options';
import type {
  ProfileLite,
  TaskAssignMode,
  TaskResponseType,
  TaskRoom,
  TaskTarget,
} from '@/types/tasks';

interface RoomSettingsProps {
  room: TaskRoom;
  onUpdated: () => void;
  stores?: { id: string; name: string }[];
  members?: ProfileLite[];
}

export function RoomSettings({ room, onUpdated, stores = [], members = [] }: RoomSettingsProps) {
  const router = useRouter();
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description ?? '');
  const [icon, setIcon] = useState(room.icon);
  const [color, setColor] = useState(room.color);
  const [assignMode, setAssignMode] = useState<TaskAssignMode>(room.assign_mode ?? 'manual');
  const [defaultResponseType, setDefaultResponseType] = useState<TaskResponseType>(
    room.default_response_type ?? 'submit',
  );
  const [responsibleTarget, setResponsibleTarget] = useState<TaskTarget>(
    room.responsible_target ?? { mode: 'manual' },
  );
  const [creatorTarget, setCreatorTarget] = useState<TaskTarget>(
    room.creator_target ?? { mode: 'everyone' },
  );
  const [requireAttachmentDefault, setRequireAttachmentDefault] = useState(
    room.require_attachment_default ?? false,
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/rooms/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          icon,
          color,
          assignMode,
          defaultResponseType,
          responsibleTarget,
          creatorTarget,
          requireAttachmentDefault,
        }),
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

      {/* ── คอนฟิกโฟลงานของห้องนี้ (ยืดหยุ่นต่อห้อง) ── */}
      <div className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">โฟลงานของห้องนี้</p>

        <Select
          label="วิธีมอบหมายเมื่อมีงานเข้า"
          value={assignMode}
          onChange={(e) => setAssignMode(e.target.value as TaskAssignMode)}
          options={ASSIGN_MODE_OPTIONS}
        />

        {assignMode !== 'manual' && (
          <TargetPicker
            label="ผู้รับผิดชอบ (กลุ่มที่ถูกแจ้ง/มอบหมาย)"
            value={responsibleTarget}
            onChange={setResponsibleTarget}
            stores={stores}
            members={members}
            hint="เช่น ตำแหน่ง = ช่าง (เลือกสาขาเพิ่มได้)"
          />
        )}

        <TargetPicker
          label="ใครเปิดเรื่อง/สร้างงานในห้องนี้ได้"
          value={creatorTarget}
          onChange={setCreatorTarget}
          stores={stores}
          members={members}
        />

        <Select
          label="โหมดตอบกลับเริ่มต้น (แก้รายงานได้)"
          value={defaultResponseType}
          onChange={(e) => setDefaultResponseType(e.target.value as TaskResponseType)}
          options={RESPONSE_TYPE_OPTIONS}
        />

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={requireAttachmentDefault}
            onChange={(e) => setRequireAttachmentDefault(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          บังคับแนบไฟล์/รูปก่อนปิดงาน (ค่าเริ่มต้นของห้อง)
        </label>
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
