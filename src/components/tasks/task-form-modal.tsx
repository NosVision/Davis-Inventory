'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, Loader2 } from 'lucide-react';
import { Modal, ModalFooter, Button, Input, Textarea, Select, toast } from '@/components/ui';
import { AttachmentInput } from './attachment-input';
import { initial, avatarColor } from '@/lib/tasks/format';
import { cn } from '@/lib/utils/cn';
import { RESPONSE_TYPE_VALUES } from '@/lib/tasks/room-options';
import type {
  ProfileLite,
  TaskAssignMode,
  TaskAttachmentInput,
  TaskPriority,
  TaskResponseType,
} from '@/types/tasks';

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
  const t = useTranslations('tasks.form');
  const tr = useTranslations('roles');
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
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchName')} leftIcon={<Search className="h-4 w-4" />} />
        </div>
        {roles.length > 1 && (
          <div className="w-36 shrink-0">
            <Select
              value={roleF}
              onChange={(e) => setRoleF(e.target.value)}
              options={[
                { value: 'all', label: t('allRoles') },
                ...roles.map((r) => ({ value: r as string, label: tr(r as Parameters<typeof tr>[0]) })),
              ]}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-0.5 text-xs">
        <button type="button" onClick={bulkToggle} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {allSelected ? t('clearFiltered') : t('selectAllFiltered')}
        </button>
        <span className="text-gray-400">{t('selectedShown', { selected: selected.length, shown: filtered.length })}</span>
      </div>

      <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-1.5 dark:border-gray-700">
        {filtered.length === 0 ? (
          <p className="p-2 text-xs text-gray-400">{t('noMembersFound')}</p>
        ) : (
          filtered.map((m) => {
            const name = m.display_name || m.username || t('defaultUser');
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
                <span className="shrink-0 text-[10px] text-gray-400">{tr(m.role as Parameters<typeof tr>[0])}</span>
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
  const t = useTranslations('tasks');
  const tc = useTranslations('common');
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
  const [assignMode, setAssignMode] = useState<TaskAssignMode>('manual');
  const [cfgLoaded, setCfgLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // โหลดคอนฟิกห้องเพื่อปรับฟอร์ม (ซ่อนช่องเลือกคนเมื่อ route ตามตำแหน่ง + ตั้งค่าเริ่มต้น)
  useEffect(() => {
    let active = true;
    fetch(`/api/tasks/rooms/${roomId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        const room = d?.room as
          | {
              assign_mode?: TaskAssignMode;
              default_response_type?: TaskResponseType;
              require_attachment_default?: boolean;
            }
          | undefined;
        if (room) {
          if (room.assign_mode) setAssignMode(room.assign_mode);
          if (room.default_response_type) setResponseType(room.default_response_type);
          if (room.require_attachment_default) setRequireAttachment(true);
        }
        setCfgLoaded(true);
      })
      .catch(() => {
        if (active) setCfgLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [roomId]);

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  // โหมดแจ้งเรื่อง: ห้อง claim/all = งาน routing อัตโนมัติ พนักงานแค่ "แจ้ง" ไม่ต้องตั้งกติกา
  // (กติกา response type / อนุมัติ / บังคับแนบไฟล์ มาจาก default ของห้องที่เจ้าของตั้งไว้)
  const reportMode = assignMode !== 'manual';

  const submit = async () => {
    if (!title.trim()) {
      toast({ type: 'error', title: t('form.titleRequired') });
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
      if (!res.ok) throw new Error(data.error || t('form.createTaskFailed'));
      toast({
        type: 'success',
        title: reportMode ? t('form.reportSent') : t('form.taskCreated'),
        message: data.task?.ticket_no,
      });
      onCreated();
      onClose();
    } catch (e) {
      toast({ type: 'error', title: tc('error'), message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={reportMode ? t('form.reportNewTitle') : t('form.addTaskTitle')} size="lg">
      {!cfgLoaded ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      ) : (
        <div className="space-y-4">
          {reportMode && (
            <p className="rounded-lg bg-indigo-50 p-3 text-xs text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300">
              {t('form.reportBanner')}
            </p>
          )}

          <Input label={t('form.taskTitleLabel')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('form.taskTitlePlaceholder')} />
          <Textarea label={t('form.taskDetailLabel')} value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} placeholder={reportMode ? t('form.taskDetailPlaceholderReport') : t('form.taskDetailPlaceholder')} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {!reportMode && (
              <Select
                label={t('form.responseTypeLabel')}
                value={responseType}
                onChange={(e) => setResponseType(e.target.value as TaskResponseType)}
                options={RESPONSE_TYPE_VALUES.map((v) => ({ value: v, label: t(`responseType.${v}`) }))}
              />
            )}
            <Input label={t('form.categoryLabel')} value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('form.categoryPlaceholder')} />
            <Select
              label={t('form.priorityLabel')}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              options={[
                { value: 'low', label: t('priority.low') },
                { value: 'med', label: t('priority.med') },
                { value: 'high', label: t('priority.high') },
              ]}
            />
            {stores.length > 0 && (
              <Select
                label={t('form.storeLabel')}
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                placeholder={t('form.storePlaceholder')}
                options={stores.map((s) => ({ value: s.id, label: s.name }))}
              />
            )}
            {!reportMode && (
              <Input label={t('form.startDateLabel')} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            )}
            {!reportMode && (
              <Input label={t('form.dueDateLabel')} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            )}
          </div>

          {assignMode === 'manual' ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('form.responsiblePeople')}</label>
              <MemberPicker
                members={members}
                selected={assigneeIds}
                onToggle={(id) => setAssigneeIds((s) => toggle(s, id))}
                empty={t('form.noMembersInRoom')}
              />
            </div>
          ) : (
            <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
              {assignMode === 'claim' ? t('form.claimNotice') : t('form.allNotice')}
            </div>
          )}

          {!reportMode && responseType === 'submit' && (
            <>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} className="h-4 w-4 rounded" />
                {t('form.requireApproval')}
              </label>

              {requiresApproval && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('form.approverLabel')} <span className="font-normal text-gray-400">{t('form.approverHint')}</span>
                  </label>
                  <MemberPicker
                    members={members}
                    selected={approverIds}
                    onToggle={(id) => setApproverIds((s) => toggle(s, id))}
                    empty={t('form.noMembersInRoom')}
                  />
                </div>
              )}

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={requireAttachment} onChange={(e) => setRequireAttachment(e.target.checked)} className="h-4 w-4 rounded" />
                {t('form.requireAttachmentTask')}
              </label>
            </>
          )}

          {!reportMode && responseType !== 'submit' && (
            <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {responseType === 'acknowledge' ? t('form.acknowledgeNote') : t('form.notifyNote')}
            </p>
          )}

          {/* แนบรูป/ไฟล์ — โหมดแจ้งเรื่องเน้นถ่ายรูปจุดที่เสีย */}
          <AttachmentInput
            value={attachments}
            onChange={setAttachments}
            label={reportMode ? t('form.attachmentLabelReport') : t('form.attachmentLabelTask')}
          />
        </div>
      )}

      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>{tc('cancel')}</Button>
        <Button onClick={submit} isLoading={saving}>{reportMode ? t('form.sendReport') : t('form.createTask')}</Button>
      </ModalFooter>
    </Modal>
  );
}
