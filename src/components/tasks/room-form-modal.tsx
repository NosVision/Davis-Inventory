'use client';

import { useState } from 'react';
import { Modal, ModalFooter, Button, Input, Textarea, Select, toast } from '@/components/ui';
import { RoomIcon } from './room-icon';
import { getRoomColor } from '@/lib/tasks/colors';

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

export function RoomFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('clipboard-list');
  const [color, setColor] = useState('indigo');
  const [ticketPrefix, setTicketPrefix] = useState('TR');
  const [saving, setSaving] = useState(false);
  const c = getRoomColor(color);

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
        body: JSON.stringify({ name: name.trim(), description, icon, color, ticketPrefix: ticketPrefix.trim() || 'TR' }),
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
    <Modal isOpen onClose={onClose} title="สร้างห้องงานใหม่" size="md">
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
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={submit} isLoading={saving}>สร้างห้อง</Button>
      </ModalFooter>
    </Modal>
  );
}
