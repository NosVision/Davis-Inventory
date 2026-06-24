import { Link2, FileText } from 'lucide-react';
import type { TaskAttachment } from '@/types/tasks';

export function AttachmentList({ attachments }: { attachments: TaskAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;

  const images = attachments.filter((a) => a.kind === 'image');
  const others = attachments.filter((a) => a.kind !== 'image');

  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((a) => (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={a.name || 'attachment'}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
            </a>
          ))}
        </div>
      )}
      {others.map((a) => (
        <a
          key={a.id}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-sky-600 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {a.kind === 'link' ? <Link2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
          <span className="truncate">{a.name || a.url}</span>
        </a>
      ))}
    </div>
  );
}
