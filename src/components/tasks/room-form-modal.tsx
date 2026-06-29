'use client';

import { useEffect, useState } from 'react';
import { Modal, ModalFooter, Button, Input, Textarea, Select, toast } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { RoomIcon } from './room-icon';
import { TargetPicker } from './target-picker';
import { getRoomColor } from '@/lib/tasks/colors';
import {
  ICON_OPTIONS,
  COLOR_OPTIONS,
  ASSIGN_MODE_OPTIONS,
  RESPONSE_TYPE_OPTIONS,
} from '@/lib/tasks/room-options';
import type { ProfileLite, TaskAssignMode, TaskResponseType, TaskTarget } from '@/types/tasks';

export function RoomFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('clipboard-list');
  const [color, setColor] = useState('indigo');
  const [ticketPrefix, setTicketPrefix] = useState('TR');

  // ── โฟลงานของห้อง (ตั้งได้ตั้งแต่ตอนสร้าง ไม่ต้องตามไปแก้ที่ตั้งค่าทีหลัง) ──
  const [assignMode, setAssignMode] = useState<TaskAssignMode>('manual');
  const [defaultResponseType, setDefaultResponseType] = useState<TaskResponseType>('submit');
  const [responsibleTarget, setResponsibleTarget] = useState<TaskTarget>({ mode: 'manual' });
  const [creatorTarget, setCreatorTarget] = useState<TaskTarget>({ mode: 'everyone' });
  const [requireAttachmentDefault, setRequireAttachmentDefault] = useState(false);

  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers] = useState<ProfileLite[]>([]);
  const [saving, setSaving] = useState(false);
  const c = getRoomColor(color);

  // โหลดสาขา + รายชื่อคน เพื่อใช้ในตัวเลือก "ผู้รับผิดชอบ" / "ใครเปิดเรื่องได้"
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('stores')
      .select('id, store_name')
      .eq('active', true)
      .then(({ data }) => {
        setStores(
          ((data as { id: string; store_name: string }[]) ?? []).map((s) => ({ id: s.id, name: s.store_name })),
        );
      });
    supabase
      .from('profiles')
      .select('id, display_name, username, avatar_url, role')
      .eq('active', true)
      .neq('role', 'customer')
      .then(({ data }) => {
        setMembers((data as ProfileLite[]) ?? []);
      });
  }, []);

  const submit = async () => {
    if (!name.trim()) {
      toast({ type: 'error', title: 'กรุณาระบุชื่อห้อง' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/tasks/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description,
          icon,
          color,
          ticketPrefix: ticketPrefix.trim() || 'TR',
          assignMode,
          defaultResponseType,
          responsibleTarget,
          creatorTarget,
          requireAttachmentDefault,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'สร้างห้องไม่สำเร็จ');
      toast({ type: 'success', title: 'สร้างห้องแล้ว' });
      onCreated();
      onClose();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="สร้างห้องงานใหม่" size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ backgroundColor: c.tint, color: c.accent }}
          >
            <RoomIcon name={icon} className="h-6 w-6" />
          </span>
          <span className="text-sm text-gray-500">ตัวอย่างไอคอนห้อง</span>
        </div>
        <Input label="ชื่อห้อง *" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น แจ้งซ่อม, บัญชี, ความสะอาด" />
        <Textarea label="คำอธิบาย" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="ไอคอน" value={icon} onChange={(e) => setIcon(e.target.value)} options={ICON_OPTIONS} />
          <Select label="สี" value={color} onChange={(e) => setColor(e.target.value)} options={COLOR_OPTIONS} />
        </div>
        <Input label="คำนำหน้าเลขงาน (Ticket)" value={ticketPrefix} onChange={(e) => setTicketPrefix(e.target.value)} placeholder="เช่น ซ่อม, TR" />

        {/* ── โฟลงานของห้องนี้ — ตั้งได้เลยตอนสร้าง ไม่ต้องตามไปแก้ที่ตั้งค่า ── */}
        <div className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
          <div>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">โฟลงานของห้องนี้</p>
            <p className="text-xs text-gray-400">ตั้งกติกาครั้งเดียว ระบบจะทำตามนี้ทุกครั้งที่มีงานเข้า (แก้ทีหลังได้ที่แท็บตั้งค่า)</p>
          </div>

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
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={submit} isLoading={saving}>สร้างห้อง</Button>
      </ModalFooter>
    </Modal>
  );
}
