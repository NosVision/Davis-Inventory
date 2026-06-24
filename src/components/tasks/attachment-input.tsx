'use client';

import { useState } from 'react';
import { PhotoUpload, Button, Input } from '@/components/ui';
import { Link2, X, FileText, ImageIcon } from 'lucide-react';
import type { TaskAttachmentInput } from '@/types/tasks';

interface AttachmentInputProps {
  value: TaskAttachmentInput[];
  onChange: (next: TaskAttachmentInput[]) => void;
  /** บังคับให้แนบอย่างน้อย 1 (UI hint) */
  required?: boolean;
  /** ป้ายกำกับ (ค่าเริ่มต้น "ไฟล์แนบ") */
  label?: string;
}

/**
 * แนบไฟล์ได้ 3 แบบ: รูปภาพ (อัปโหลด) / ลิงก์ URL (เอกสาร/ลิงก์ภายนอก)
 * ไม่บังคับ — แนบกี่อันก็ได้ คละชนิดได้
 */
export function AttachmentInput({ value, onChange, required, label = 'ไฟล์แนบ' }: AttachmentInputProps) {
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');

  const addImage = (url: string | null) => {
    if (url) onChange([...value, { kind: 'image', url }]);
  };

  const addLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    onChange([...value, { kind: 'link', url, name: linkName.trim() || url }]);
    setLinkUrl('');
    setLinkName('');
  };

  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
          {!required && <span className="ml-1 text-xs font-normal text-gray-400">(ไม่บังคับ)</span>}
        </label>
      </div>

      {/* รายการที่แนบแล้ว */}
      {value.length > 0 && (
        <ul className="space-y-1.5">
          {value.map((a, i) => (
            <li
              key={`${a.url}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800/50"
            >
              {a.kind === 'image' ? (
                <ImageIcon className="h-4 w-4 shrink-0 text-indigo-500" />
              ) : a.kind === 'link' ? (
                <Link2 className="h-4 w-4 shrink-0 text-sky-500" />
              ) : (
                <FileText className="h-4 w-4 shrink-0 text-amber-500" />
              )}
              <span className="flex-1 truncate text-gray-700 dark:text-gray-300">
                {a.name || a.url}
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* เพิ่มรูป */}
      <PhotoUpload value={null} onChange={addImage} folder="tasks" compact placeholder="แนบรูปภาพ" />

      {/* เพิ่มลิงก์ / ไฟล์ */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="วางลิงก์ไฟล์ / เอกสาร (URL)"
          className="flex-1"
        />
        <Input
          value={linkName}
          onChange={(e) => setLinkName(e.target.value)}
          placeholder="ชื่อ (ถ้ามี)"
          className="sm:w-40"
        />
        <Button type="button" variant="outline" size="md" onClick={addLink} icon={<Link2 className="h-4 w-4" />}>
          เพิ่มลิงก์
        </Button>
      </div>
    </div>
  );
}
