'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal, ModalFooter, Button, Input, Textarea, Select, toast } from '@/components/ui';
import { MemberPicker } from './task-form-modal';
import { AttachmentInput } from './attachment-input';
import { todayBangkok } from '@/lib/utils/date';
import { RESPONSE_TYPE_VALUES } from '@/lib/tasks/room-options';
import type { ProfileLite, TaskPriority, TaskRecurrenceKind, TaskResponseType, TaskAttachmentInput } from '@/types/tasks';

interface RecurrenceFormModalProps {
  roomId: string;
  members: ProfileLite[];
  onClose: () => void;
  onCreated: () => void;
}

const KIND_VALUES = ['once', 'day_of_month', 'every_weeks', 'every_months'] as const;
const KIND_LABEL_KEYS: Record<(typeof KIND_VALUES)[number], string> = {
  once: 'kindOnce',
  day_of_month: 'kindDayOfMonth',
  every_weeks: 'kindEveryWeeks',
  every_months: 'kindEveryMonths',
};

export function RecurrenceFormModal({ roomId, members, onClose, onCreated }: RecurrenceFormModalProps) {
  const t = useTranslations('tasks');
  const tc = useTranslations('common');
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
    if (!title.trim()) return toast({ type: 'error', title: t('recurring.nameRequired') });
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
      if (!res.ok) throw new Error(data.error || t('recurring.createFailed'));
      toast({ type: 'success', title: t('recurring.created') });
      onCreated();
      onClose();
    } catch (e) {
      toast({ type: 'error', title: tc('error'), message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={t('recurring.modalTitle')} size="lg">
      <div className="space-y-4">
        <Input label={t('recurring.nameLabel')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('recurring.namePlaceholder')} />
        <Textarea label={t('recurring.detailLabel')} value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('recurring.categoryLabel')} value={category} onChange={(e) => setCategory(e.target.value)} />
          <Select label={t('recurring.priorityLabel')} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} options={[{ value: 'low', label: t('priority.low') }, { value: 'med', label: t('priority.med') }, { value: 'high', label: t('priority.high') }]} />
          <Select
            label={t('recurring.responseTypeLabel')}
            value={responseType}
            onChange={(e) => setResponseType(e.target.value as TaskResponseType)}
            options={RESPONSE_TYPE_VALUES.map((v) => ({ value: v, label: t(`responseType.${v}`) }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select label={t('recurring.cycleLabel')} value={kind} onChange={(e) => setKind(e.target.value as TaskRecurrenceKind)} options={KIND_VALUES.map((v) => ({ value: v, label: t(`recurring.${KIND_LABEL_KEYS[v]}`) }))} />
          <Input label={kind === 'once' ? t('recurring.dateLabel') : t('recurring.startFromLabel')} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          {kind === 'day_of_month' && (
            <Select label={t('recurring.dayOfMonthLabel')} value={String(dayOfMonth)} onChange={(e) => setDayOfMonth(Number(e.target.value))} options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: t('recurring.dayOfMonthOption', { day: i + 1 }) }))} />
          )}
          {(kind === 'every_weeks' || kind === 'every_months') && (
            <Input label={kind === 'every_weeks' ? t('recurring.everyWeeksLabel') : t('recurring.everyMonthsLabel')} type="number" min={1} value={intervalCount} onChange={(e) => setIntervalCount(Math.max(1, Number(e.target.value)))} />
          )}
          <Input label={t('recurring.remindDaysLabel')} type="number" min={0} value={remindEveryDays} onChange={(e) => setRemindEveryDays(e.target.value)} placeholder={t('recurring.remindDaysPlaceholder')} />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('recurring.defaultAssignees')}</label>
          <MemberPicker members={members} selected={assigneeIds} onToggle={(id) => setAssigneeIds((s) => toggle(s, id))} empty={t('recurring.noMembersInRoom')} />
        </div>

        {responseType === 'submit' ? (
          <>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} className="h-4 w-4 rounded" />
              {t('recurring.requireApproval')}
            </label>
            {requiresApproval && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('recurring.approverLabel')}</label>
                <MemberPicker members={members} selected={approverIds} onToggle={(id) => setApproverIds((s) => toggle(s, id))} empty={t('recurring.noMembers')} />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={requireAttachment} onChange={(e) => setRequireAttachment(e.target.checked)} className="h-4 w-4 rounded" />
              {t('recurring.requireAttachment')}
            </label>
          </>
        ) : (
          <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {responseType === 'acknowledge' ? t('recurring.acknowledgeNote') : t('recurring.notifyNote')}
          </p>
        )}

        <AttachmentInput
          value={attachments}
          onChange={setAttachments}
          label={t('recurring.attachmentLabel')}
        />
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>{tc('cancel')}</Button>
        <Button onClick={submit} isLoading={saving}>{t('recurring.createButton')}</Button>
      </ModalFooter>
    </Modal>
  );
}
