'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { Modal, ModalFooter, Button, Input, Textarea, Select, toast } from '@/components/ui';
import { AttachmentInput } from './attachment-input';
import { initial, avatarColor } from '@/lib/tasks/format';
import { cn } from '@/lib/utils/cn';
import { ROLE_LABELS, type UserRole } from '@/types/roles';
import { TASK_RESPONSE_TYPE_LABELS } from '@/lib/tasks/status';
import type { ProfileLite, TaskAttachmentInput, TaskPriority, TaskResponseType } from '@/types/tasks';

interface StoreOption {
  id: string;
  name: string;
}

interface TaskFormModalProps {
  roomId: string;
  members: ProfileLite[];
  stores: StoreOption[];
  onClose: () => void;
  onCreated: () => void;
}

export function MemberPicker({
  members,
  selected,
  onToggle,
  empty,
}: {
  members: ProfileLite[];
  selected: string[];
  onToggle: (id: string) => void;
  empty: string;
}) {
  const [q, setQ] = useState('');
  const [roleF, setRoleF] = useState('all');

  if (members.length === 0) {
    return <p className="text-xs text-gray-400">{empty}</p>;
  }

  const roles = [...new Set(members.map((m) => m.role).filter(Boolean))];
  const ql = q.trim().toLowerCase();
  const filtered = members.filter((m) => {
    if (roleF !== 'all' && m.role !== roleF) return false;
    if (ql && !`${m.display_name ?? ''} ${m.username ?? ''}`.toLowerCase().includes(ql)) return false;
    return true;
  });
  const filteredIds = filtered.map((m) => m.id);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.includes(id));
  const bulkToggle = () => {
    filteredIds.forEach((id) => {
      const isOn = selected.includes(id);
      if (allSelected && isOn) onToggle(id);
      else if (!allSelected && !isOn) onToggle(id);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ" leftIcon={<Search className="h-4 w-4" />} />
        </div>
        {roles.length > 1 && (
          <div className="w-36 shrink-0">
            <Select
              value={roleF}
              onChange={(e) => setRoleF(e.target.value)}
              options={[
                { value: 'all', label: 'ทุกตำแหน่ง' },
                ...roles.map((r) => ({ value: r, label: ROLE_LABELS[r as UserRole] ?? r })),
              ]}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-0.5 text-xs">
        <button type="button" onClick={bulkToggle} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {allSelected ? 'ล้างที่กรอง' : 'เลือกทั้งหมดที่กรอง'}
        </button>
        <span className="text-gray-400">เลือกแล้ว {selected.length} · แสดง {filtered.length}</span>
      </div>

      <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-1.5 dark:border-gray-700">
        {filtered.length === 0 ? (
          <p className="p-2 text-xs text-gray-400">ไม่พบสมาชิก</p>
        ) : (
          filtered.map((m) => {
            const name = m.display_name || m.username || 'ผู้ใช้';
            const on = selected.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onToggle(m.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  on ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800',
                )}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                  style={{ backgroundColor: avatarColor(m.id) }}
                >
                  {initial(name)}
                </span>
                <span className="flex-1 truncate text-gray-700 dark:text-gray-200">{name}</span>
                <span className="shrink-0 text-[10px] text-gray-400">{ROLE_LABELS[m.role as UserRole] ?? m.role}</span>
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]',
                    on ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-gray-300 dark:border-gray-600',
                  )}
                >
                  {on ? '✓' : ''}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export function TaskFormModal({ roomId, members, stores, onClose, onCreated }: TaskFormModalProps) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [category, setCategory] = useState('');
  const [storeId, setStoreId] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('med');
  const [responseType, setResponseType] = useState<TaskResponseType>('submit');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [requireAttachment, setRequireAttachment] = useState(false);
  const [attachments, setAttachments] = useState<TaskAttachmentInput[]>([]);
  const [saving, setSaving] = useState(false);

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const submit = async () => {
    if (!title.trim()) {
      toast({ type: 'error', title: 'กรุณาระบุหัวข้องาน' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          title: title.trim(),
          detail: detail.trim() || undefined,
          category: category.trim() || undefined,
          storeId: storeId || null,
          priority,
          responseType,
          startDate: startDate || null,
          dueDate: dueDate || null,
          requiresApproval,
          approverIds: requiresApproval ? approverIds : [],
          requireAttachment,
          assigneeIds,
          attachments,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'สร้างงานไม่สำเร็จ');
      toast({ type: 'success', title: 'สร้างงานแล้ว', message: data.task?.ticket_no });
      onCreated();
      onClose();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="เพิ่มงานใหม่" size="lg">
      <div className="space-y-4">
        <Input label="หัวข้องาน *" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น แอร์โซนครัวไม่เย็น" />
        <Textarea label="รายละเอียด" value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} placeholder="อธิบายงาน..." />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <Input label="หมวด" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="เช่น ไฟฟ้า, ประปา" />
          <Select
            label="ความสำคัญ"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            options={[
              { value: 'low', label: 'ต่ำ' },
              { value: 'med', label: 'กลาง' },
              { value: 'high', label: 'สูง' },
            ]}
          />
          {stores.length > 0 && (
            <Select
              label="สาขา (Venue)"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              placeholder="— ไม่ระบุ —"
              options={stores.map((s) => ({ value: s.id, label: s.name }))}
            />
          )}
          <Input label="วันเริ่มงาน (เว้นว่าง = เริ่มทันที)" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label="กำหนดเสร็จ" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">ผู้รับผิดชอบ</label>
          <MemberPicker
            members={members}
            selected={assigneeIds}
            onToggle={(id) => setAssigneeIds((s) => toggle(s, id))}
            empty="ยังไม่มีสมาชิกในห้องนี้"
          />
        </div>

        {responseType === 'submit' && (
          <>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} className="h-4 w-4 rounded" />
              ต้องอนุมัติเมื่อทำเสร็จ
            </label>

            {requiresApproval && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  ผู้อนุมัติ / ตรวจงาน <span className="font-normal text-gray-400">(ใครก็ได้ในรายชื่ออนุมัติได้ · ว่าง = เจ้าของอนุมัติ)</span>
                </label>
                <MemberPicker
                  members={members}
                  selected={approverIds}
                  onToggle={(id) => setApproverIds((s) => toggle(s, id))}
                  empty="ยังไม่มีสมาชิกในห้องนี้"
                />
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={requireAttachment} onChange={(e) => setRequireAttachment(e.target.checked)} className="h-4 w-4 rounded" />
              บังคับให้ผู้ทำแนบไฟล์/รูปก่อนปิดงาน
            </label>
          </>
        )}

        {responseType !== 'submit' && (
          <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {responseType === 'acknowledge'
              ? 'พนักงานเพียงกด "รับทราบ" เพื่อปิดงาน — ไม่ต้องส่งงาน/อนุมัติ'
              : 'งานแจ้งเพื่อทราบ — พนักงานเปิดอ่านแล้วกด "รับทราบว่าอ่านแล้ว" เพื่อปิด'}
          </p>
        )}

        {/* ไฟล์/รูป/ลิงก์ที่เจ้าของแนบให้ผู้รับงานดู — ได้ทุกประเภทงาน */}
        <AttachmentInput
          value={attachments}
          onChange={setAttachments}
          label="ไฟล์/รูป/ลิงก์ประกอบงาน (ให้ผู้รับงานดู)"
        />
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={submit} isLoading={saving}>สร้างงาน</Button>
      </ModalFooter>
    </Modal>
  );
}
