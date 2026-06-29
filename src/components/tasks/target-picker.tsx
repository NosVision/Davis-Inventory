'use client';

import { ROLE_LABELS, type UserRole } from '@/types/roles';
import type { ProfileLite, TaskTarget, TaskTargetMode } from '@/types/tasks';
import { MemberPicker } from './task-form-modal';
import { cn } from '@/lib/utils/cn';

/** ตำแหน่งที่เลือกเป็นผู้รับผิดชอบ/ผู้เปิดเรื่องได้ตามปกติ (ตัด customer ออก) */
const DEFAULT_ROLE_OPTIONS: UserRole[] = [
  'owner',
  'manager',
  'accountant',
  'bar',
  'technician',
  'staff',
];

const MODE_LABELS: Record<TaskTargetMode, string> = {
  manual: 'เลือกตอนสร้างงาน',
  everyone: 'ทุกคน',
  stores: 'เฉพาะสาขา',
  roles: 'เฉพาะตำแหน่ง',
  users: 'เฉพาะคน',
};

interface TargetPickerProps {
  value: TaskTarget;
  onChange: (next: TaskTarget) => void;
  stores: { id: string; name: string }[];
  /** รายชื่อคน (สำหรับโหมด "เฉพาะคน") */
  members?: ProfileLite[];
  /** ตำแหน่งที่ให้เลือก (ดีฟอลต์ = ทุกตำแหน่งยกเว้นลูกค้า) */
  roleOptions?: UserRole[];
  /** แสดงตัวเลือก "เลือกตอนสร้างงาน" (manual) — ใช้กับผู้รับผิดชอบ */
  allowManual?: boolean;
  label?: string;
  hint?: string;
}

const chip = (on: boolean) =>
  cn(
    'rounded-md px-2 py-1 text-xs ring-1 transition-colors',
    on
      ? 'bg-indigo-50 text-indigo-700 ring-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-300'
      : 'text-gray-600 ring-gray-200 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-gray-800',
  );

/**
 * ตัวเลือกกลุ่มเป้าหมายแบบยืดหยุ่น ใช้ซ้ำได้ทั้ง "ผู้รับผิดชอบ" และ "ใครเปิดเรื่องได้"
 * โหมด roles เลือกสาขาเพิ่มได้ (เช่น ช่างเฉพาะบางสาขา)
 */
export function TargetPicker({
  value,
  onChange,
  stores,
  members = [],
  roleOptions = DEFAULT_ROLE_OPTIONS,
  allowManual = false,
  label,
  hint,
}: TargetPickerProps) {
  const modes: TaskTargetMode[] = [
    ...(allowManual ? (['manual'] as TaskTargetMode[]) : []),
    'everyone',
    'stores',
    'roles',
    'users',
  ];

  const setMode = (mode: TaskTargetMode) => onChange({ ...value, mode });

  const toggleArr = (key: 'storeIds' | 'roles' | 'userIds', id: string) => {
    const cur = value[key] ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    onChange({ ...value, [key]: next });
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}

      <div className="flex flex-wrap gap-1.5">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors',
              value.mode === m
                ? 'bg-indigo-600 text-white ring-indigo-600'
                : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700',
            )}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {hint && <p className="text-xs text-gray-400">{hint}</p>}

      {value.mode === 'stores' && (
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
          {stores.length === 0 ? (
            <p className="text-xs text-gray-400">ไม่มีสาขา</p>
          ) : (
            stores.map((s) => {
              const on = (value.storeIds ?? []).includes(s.id);
              return (
                <button key={s.id} type="button" onClick={() => toggleArr('storeIds', s.id)} className={chip(on)}>
                  {on ? '✓ ' : ''}
                  {s.name}
                </button>
              );
            })
          )}
        </div>
      )}

      {value.mode === 'roles' && (
        <div className="space-y-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
          <div className="flex flex-wrap gap-1.5">
            {roleOptions.map((r) => {
              const on = (value.roles ?? []).includes(r);
              return (
                <button key={r} type="button" onClick={() => toggleArr('roles', r)} className={chip(on)}>
                  {on ? '✓ ' : ''}
                  {ROLE_LABELS[r]}
                </button>
              );
            })}
          </div>
          {stores.length > 0 && (
            <div className="border-t border-gray-100 pt-2 dark:border-gray-700">
              <p className="mb-1 text-[11px] text-gray-400">จำกัดสาขา (เว้น = ทุกสาขา)</p>
              <div className="flex flex-wrap gap-1.5">
                {stores.map((s) => {
                  const on = (value.storeIds ?? []).includes(s.id);
                  return (
                    <button key={s.id} type="button" onClick={() => toggleArr('storeIds', s.id)} className={chip(on)}>
                      {on ? '✓ ' : ''}
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {value.mode === 'users' && (
        <MemberPicker
          members={members}
          selected={value.userIds ?? []}
          onToggle={(id) => toggleArr('userIds', id)}
          empty="ไม่มีสมาชิกให้เลือก"
        />
      )}
    </div>
  );
}
