'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal, ModalFooter, Button, Input, Textarea, Select, toast } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { RoomIcon } from './room-icon';
import { IconPicker, ColorPicker } from './icon-color-picker';
import { TargetPicker } from './target-picker';
import { getRoomColor } from '@/lib/tasks/colors';
import { ASSIGN_MODE_VALUES, RESPONSE_TYPE_VALUES } from '@/lib/tasks/room-options';
import type { ProfileLite, TaskAssignMode, TaskResponseType, TaskTarget } from '@/types/tasks';

export function RoomFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useTranslations('tasks');
  const tc = useTranslations('common');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('clipboard-list');
  const [color, setColor] = useState('indigo');

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
      toast({ type: 'error', title: t('form.nameRequired') });
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
          assignMode,
          defaultResponseType,
          responsibleTarget,
          creatorTarget,
          requireAttachmentDefault,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('form.createRoomFailed'));
      toast({ type: 'success', title: t('form.roomCreated') });
      onCreated();
      onClose();
    } catch (e) {
      toast({ type: 'error', title: tc('error'), message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={t('form.createRoomTitle')} size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ backgroundColor: c.tint, color: c.accent }}
          >
            <RoomIcon name={icon} className="h-6 w-6" />
          </span>
          <span className="text-sm text-gray-500">{t('form.iconPreview')}</span>
        </div>
        <Input label={t('form.roomNameLabel')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('form.roomNamePlaceholder')} />
        <Textarea label={t('form.descriptionLabel')} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <IconPicker value={icon} onChange={setIcon} color={color} />
          <ColorPicker value={color} onChange={setColor} />
        </div>

        {/* ── โฟลงานของห้องนี้ — ตั้งได้เลยตอนสร้าง ไม่ต้องตามไปแก้ที่ตั้งค่า ── */}
        <div className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
          <div>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('form.roomWorkflow')}</p>
            <p className="text-xs text-gray-400">{t('form.roomWorkflowHintCreate')}</p>
          </div>

          <Select
            label={t('form.assignModeLabel')}
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
              label={t('form.responsibleLabel')}
              value={responsibleTarget}
              onChange={setResponsibleTarget}
              stores={stores}
              members={members}
              hint={t('form.responsibleHint')}
            />
          )}

          <TargetPicker
            label={t('form.creatorLabel')}
            value={creatorTarget}
            onChange={setCreatorTarget}
            stores={stores}
            members={members}
          />

          <Select
            label={t('form.defaultResponseTypeLabel')}
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
            {t('form.requireAttachmentDefault')}
          </label>
        </div>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>{tc('cancel')}</Button>
        <Button onClick={submit} isLoading={saving}>{t('form.createRoomButton')}</Button>
      </ModalFooter>
    </Modal>
  );
}
