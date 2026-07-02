'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Input, Textarea, Select, toast } from '@/components/ui';
import { Archive } from 'lucide-react';
import { TargetPicker } from './target-picker';
import { IconPicker, ColorPicker } from './icon-color-picker';
import { ASSIGN_MODE_VALUES, RESPONSE_TYPE_VALUES } from '@/lib/tasks/room-options';
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
  const t = useTranslations('tasks');
  const tc = useTranslations('common');
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
      if (!res.ok) throw new Error(data.error || t('settings.saveFailed'));
      toast({ type: 'success', title: t('settings.saved') });
      onUpdated();
    } catch (e) {
      toast({ type: 'error', title: tc('error'), message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!confirm(t('settings.confirmArchive'))) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/rooms/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('settings.archiveFailed'));
      toast({ type: 'success', title: t('settings.archived') });
      router.push('/tasks');
    } catch (e) {
      toast({ type: 'error', title: tc('error'), message: e instanceof Error ? e.message : '' });
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Input label={t('settings.roomNameLabel')} value={name} onChange={(e) => setName(e.target.value)} />
      <Textarea label={t('settings.descriptionLabel')} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <IconPicker value={icon} onChange={setIcon} color={color} />
        <ColorPicker value={color} onChange={setColor} />
      </div>

      {/* ── คอนฟิกโฟลงานของห้องนี้ (ยืดหยุ่นต่อห้อง) ── */}
      <div className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('settings.roomWorkflow')}</p>

        <Select
          label={t('settings.assignModeLabel')}
          value={assignMode}
          onChange={(e) => {
            const next = e.target.value as TaskAssignMode;
            setAssignMode(next);
            // ป้องกันค่า responsibleTarget ค้างเป็น 'manual' ตอนเปลี่ยนมาเป็น claim/all
            // (TargetPicker ของผู้รับผิดชอบไม่มีตัวเลือก 'manual' ให้กด จะไม่มีปุ่มไหน active เลย)
            if (next !== 'manual' && responsibleTarget.mode === 'manual') {
              setResponsibleTarget({ mode: 'everyone' });
            }
          }}
          options={ASSIGN_MODE_VALUES.map((v) => ({ value: v, label: t(`assignModeOption.${v}`) }))}
        />

        {assignMode !== 'manual' && (
          <TargetPicker
            label={t('settings.responsibleLabel')}
            value={responsibleTarget}
            onChange={setResponsibleTarget}
            stores={stores}
            members={members}
            hint={t('settings.responsibleHint')}
          />
        )}

        <TargetPicker
          label={t('settings.creatorLabel')}
          value={creatorTarget}
          onChange={setCreatorTarget}
          stores={stores}
          members={members}
        />

        <Select
          label={t('settings.defaultResponseTypeLabel')}
          value={defaultResponseType}
          onChange={(e) => setDefaultResponseType(e.target.value as TaskResponseType)}
          options={RESPONSE_TYPE_VALUES.map((v) => ({ value: v, label: t(`responseTypeOption.${v}`) }))}
        />

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={requireAttachmentDefault}
            onChange={(e) => setRequireAttachmentDefault(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          {t('settings.requireAttachmentDefault')}
        </label>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving}>{tc('save')}</Button>
      </div>

      {!room.is_system && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-900/40 dark:bg-red-900/10">
          <p className="mb-1 text-sm font-medium text-red-700 dark:text-red-400">{t('settings.dangerZone')}</p>
          <p className="mb-3 text-xs text-red-500">{t('settings.archiveHint')}</p>
          <Button variant="danger" size="sm" icon={<Archive className="h-4 w-4" />} onClick={archive} disabled={saving}>
            {t('settings.archiveButton')}
          </Button>
        </div>
      )}
    </div>
  );
}
