'use client';

import { useState } from 'react';
import { Modal, ModalFooter, Button, Input, Textarea, Select, toast } from '@/components/ui';
import { MemberPicker } from './task-form-modal';
import { AttachmentInput } from './attachment-input';
import { todayBangkok } from '@/lib/utils/date';
import { TASK_RESPONSE_TYPE_LABELS } from '@/lib/tasks/status';
import type { ProfileLite, TaskPriority, TaskRecurrenceKind, TaskResponseType, TaskAttachmentInput } from '@/types/tasks';

interface RecurrenceFormModalProps {
  roomId: string;
  members: ProfileLite[];
  onClose: () => void;
  onCreated: () => void;
}

const KIND_OPTIONS = [
  { value: 'once', label: 'ครั้งเดียว (ระบุวันที่)' },
  { value: 'day_of_month', label: 'ทุกวันที่ N ของเดือน' },
  { value: 'every_weeks', label: 'ทุกๆ N สัปดาห์' },
  { value: 'every_months', label: 'ทุกๆ N เดือน' },
];

export function RecurrenceFormModal({ roomId, members, onClose, onCreated }: RecurrenceFormModalProps) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('med');
  const [responseType, setResponseType] = useState<TaskResponseType>('submit');
  const [kind, setKind] = useState<TaskRecurrenceKind>('every_months');
  const [startDate, setStartDate] = useState(todayBangkok());
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [intervalCount, setIntervalCount] = useState(1);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [requireAttachment, setRequireAttachment] = useState(false);
  const [attachments, setAttachments] = useState<TaskAttachmentInput[]>([]);
  const [remindEveryDays, setRemindEveryDays] = useState('');
  const [saving, setSaving] = useState(false);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const submit = async () => {
    if (!title.trim()) return toast({ type: 'error', title: 'ระบุชื่องาน' });
    setSaving(true);
    try {
      const res = await fetch('/api/tasks/recurrences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          title: title.trim(),
          detail: detail.trim() || undefined,
          category: category.trim() || undefined,
          priority,
          kind,
          startDate,
          dayOfMonth: kind === 'day_of_month' ? dayOfMonth : undefined,
          intervalCount,
          responseType,
          requiresApproval,
          approverIds: requiresApproval ? approverIds : [],
          requireAttachment,
          attachments,
          defaultAssigneeIds: assigneeIds,
          remindEveryDays: remindEveryDays ? Number(remindEveryDays) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'สร้างงานประจำไม่สำเร็จ');
      toast({ type: 'success', title: 'สร้างงานประจำแล้ว' });
      onCreated();
      onClose();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="ตั้งงานประจำ" size="lg">
      <div className="space-y-4">
        <Input label="ชื่องาน *" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ตรวจเช็คระบบไฟสำรอง" />
        <Textarea label="รายละเอียด" value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="หมวด" value={category} onChange={(e) => setCategory(e.target.value)} />
          <Select label="ความสำคัญ" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} options={[{ value: 'low', label: 'ต่ำ' }, { value: 'med', label: 'กลาง' }, { value: 'high', label: 'สูง' }]} />
          <Select
            label="ประเภทการตอบกลับ"
            value={responseType}
            onChange={(e) => setResponseType(e.target.value as TaskResponseType)}
            options={[
              { value: 'submit', label: TASK_RESPONSE_TYPE_LABELS.submit },
              { value: 'acknowledge', label: TASK_RESPONSE_TYPE_LABELS.acknowledge },
              { value: 'notify', label: TASK_RESPONSE_TYPE_LABELS.notify },
            ]}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select label="รอบการทำซ้ำ" value={kind} onChange={(e) => setKind(e.target.value as TaskRecurrenceKind)} options={KIND_OPTIONS} />
          <Input label={kind === 'once' ? 'วันที่' : 'เริ่มตั้งแต่วันที่'} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          {kind === 'day_of_month' && (
            <Select label="วันที่ของเดือน" value={String(dayOfMonth)} onChange={(e) => setDayOfMonth(Number(e.target.value))} options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `วันที่ ${i + 1}` }))} />
          )}
          {(kind === 'every_weeks' || kind === 'every_months') && (
            <Input label={kind === 'every_weeks' ? 'ทุกๆ กี่สัปดาห์' : 'ทุกๆ กี่เดือน'} type="number" min={1} value={intervalCount} onChange={(e) => setIntervalCount(Math.max(1, Number(e.target.value)))} />
          )}
          <Input label="เตือนล่วงหน้าทุกๆ (วัน)" type="number" min={0} value={remindEveryDays} onChange={(e) => setRemindEveryDays(e.target.value)} placeholder="ไม่ระบุ" />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">ผู้รับผิดชอบประจำ</label>
          <MemberPicker members={members} selected={assigneeIds} onToggle={(id) => setAssigneeIds((s) => toggle(s, id))} empty="ยังไม่มีสมาชิกในห้องนี้" />
        </div>

        {responseType === 'submit' ? (
          <>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} className="h-4 w-4 rounded" />
              ต้องอนุมัติเมื่อทำเสร็จ
            </label>
            {requiresApproval && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">ผู้อนุมัติ</label>
                <MemberPicker members={members} selected={approverIds} onToggle={(id) => setApproverIds((s) => toggle(s, id))} empty="ยังไม่มีสมาชิก" />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={requireAttachment} onChange={(e) => setRequireAttachment(e.target.checked)} className="h-4 w-4 rounded" />
              ต้องแนบไฟล์/รูปก่อนปิดงาน
            </label>
          </>
        ) : (
          <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {responseType === 'acknowledge'
              ? 'พนักงานเพียงกด "รับทราบ" เพื่อปิดงานแต่ละรอบ'
              : 'งานแจ้งเพื่อทราบ — กด "รับทราบว่าอ่านแล้ว" เพื่อปิดแต่ละรอบ'}
          </p>
        )}

        <AttachmentInput
          value={attachments}
          onChange={setAttachments}
          label="ไฟล์/รูป/ลิงก์ประกอบงาน (แนบให้ทุกครั้งที่งานนี้ขึ้น)"
        />
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={submit} isLoading={saving}>สร้างงานประจำ</Button>
      </ModalFooter>
    </Modal>
  );
}
