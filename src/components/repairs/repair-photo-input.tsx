'use client';

import { useCallback } from 'react';
import { X } from 'lucide-react';
import { PhotoUpload } from '@/components/ui';

interface RepairPhotoInputProps {
  value: string[];
  onChange: (urls: string[]) => void;
  folder?: string;
  label?: string;
  max?: number;
  disabled?: boolean;
}

/**
 * Collect multiple photos by reusing the single-photo <PhotoUpload>.
 * Each successful upload appends to the array; PhotoUpload resets itself
 * (value stays null) so it doubles as an "add another" control.
 */
export function RepairPhotoInput({
  value,
  onChange,
  folder = 'repairs',
  label,
  max = 6,
  disabled = false,
}: RepairPhotoInputProps) {
  const add = useCallback(
    (url: string | null) => {
      if (url) onChange([...value, url]);
    },
    [value, onChange],
  );

  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}

      {value.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {value.map((url, i) => (
            <div
              key={`${url}-${i}`}
              className="group relative overflow-hidden rounded-lg ring-1 ring-gray-200 dark:ring-gray-700"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-24 w-full object-cover" />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-red-500/80"
                  aria-label="ลบรูป"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {value.length < max && !disabled && (
        <PhotoUpload value={null} onChange={add} folder={folder} compact />
      )}
    </div>
  );
}
