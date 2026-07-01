'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { RoomIcon } from './room-icon';
import { getRoomColor } from '@/lib/tasks/colors';
import { ICON_OPTIONS, COLOR_OPTIONS } from '@/lib/tasks/room-options';

interface IconPickerProps {
  value: string;
  onChange: (value: string) => void;
  /** สีของห้อง — ใช้ทำ preview ไอคอนให้ตรงกับสีที่เลือก */
  color: string;
  label?: string;
}

/** ปุ่มแสดงไอคอนปัจจุบัน กดแล้วเปิด modal ตารางไอคอนให้เลือก */
export function IconPicker({ value, onChange, color, label }: IconPickerProps) {
  const t = useTranslations('tasks');
  const [open, setOpen] = useState(false);
  const c = getRoomColor(color);
  const current = ICON_OPTIONS.find((o) => o.value === value);
  const resolvedLabel = label ?? t('iconPicker.label');

  // กัน esc ปิด modal สร้างห้องพร้อมกัน — จับ esc ที่ตัวเองก่อน
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{resolvedLabel}</label>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm transition hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: c.tint, color: c.accent }}
        >
          <RoomIcon name={value} className="h-4 w-4" />
        </span>
        <span className="flex-1 truncate text-gray-600 dark:text-gray-300">{current?.label ?? t('iconPicker.selectIcon')}</span>
        <span className="shrink-0 text-xs text-gray-400">{t('iconPicker.change')}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[80dvh] w-full max-w-md flex-col rounded-2xl bg-white shadow-xl dark:bg-gray-800">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">{t('iconPicker.modalTitle')}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-5 gap-2 overflow-y-auto p-4 sm:grid-cols-6">
              {ICON_OPTIONS.map((o) => {
                const active = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    title={o.label}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex aspect-square items-center justify-center rounded-xl border transition',
                      active
                        ? 'border-transparent'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40',
                    )}
                    style={active ? { backgroundColor: c.tint, color: c.accent, boxShadow: `0 0 0 2px ${c.accent}` } : undefined}
                  >
                    <RoomIcon name={o.value} className="h-5 w-5" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

/** แถวสีให้กดเลือกได้ทันที (swatch picker) */
export function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  const t = useTranslations('tasks');
  const resolvedLabel = label ?? t('colorPicker.label');
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{resolvedLabel}</label>
      <div className="flex flex-wrap gap-2 rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
        {COLOR_OPTIONS.map((o) => {
          const c = getRoomColor(o.value);
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              title={o.label}
              aria-label={o.label}
              onClick={() => onChange(o.value)}
              className="flex h-7 w-7 items-center justify-center rounded-full transition hover:scale-110"
              style={{
                backgroundColor: c.accent,
                boxShadow: active ? `0 0 0 2px #fff, 0 0 0 4px ${c.accent}` : 'none',
              }}
            >
              {active && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
