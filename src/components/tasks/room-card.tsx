'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Users, MapPin, Star, MessageCircle } from 'lucide-react';
import { RoomIcon } from './room-icon';
import { getRoomColor } from '@/lib/tasks/colors';
import { cn } from '@/lib/utils/cn';
import type { TaskRoomWithStats } from '@/types/tasks';

export function RoomCard({ room, onChanged }: { room: TaskRoomWithStats; onChanged?: () => void }) {
  const t = useTranslations('tasks');
  const c = getRoomColor(room.color);
  const [busy, setBusy] = useState(false);

  const toggleFav = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/tasks/rooms/${room.id}/favorite`, {
        method: room.is_favorite ? 'DELETE' : 'POST',
      });
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Link
      href={`/tasks/${room.id}`}
      className="group relative flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
    >
      <button
        type="button"
        onClick={toggleFav}
        disabled={busy}
        title={room.is_favorite ? t('room.removeFromFavorite') : t('room.addToFavorite')}
        className="absolute right-2 top-2 rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-gray-100 hover:text-amber-400 disabled:opacity-50 dark:hover:bg-gray-700"
      >
        <Star className={cn('h-4 w-4', room.is_favorite && 'fill-amber-400 text-amber-400')} />
      </button>

      <div className="flex items-start gap-3 pr-7">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: c.tint, color: c.accent }}
        >
          <RoomIcon name={room.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 truncate font-semibold text-gray-900 dark:text-white">
            <span className="truncate">{room.name}</span>
            {room.line_notify_enabled && (
              <MessageCircle className="h-3.5 w-3.5 shrink-0 text-green-500" aria-label="LINE" />
            )}
          </h3>
          {room.description && (
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{room.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <b className="text-sm">{room.pending}</b> {t('room.pendingApproval')}
        </span>
        <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400">
          <b className="text-sm">{room.in_progress}</b> {t('room.inProgress')}
        </span>
        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <b className="text-sm">{room.done}</b> {t('room.done')}
        </span>
      </div>

      <div className="flex flex-col gap-1 border-t border-gray-100 pt-2 text-xs text-gray-400 dark:border-gray-700">
        {(room.has_all_branch || room.branches.length > 0) && (
          <div className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {room.has_all_branch
                ? t('roomsList.allBranches')
                : room.branches.slice(0, 3).join(' · ') +
                  (room.branches.length > 3 ? ` +${room.branches.length - 3}` : '')}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          {t('room.peopleCount', { count: room.members_count })}
        </div>
      </div>
    </Link>
  );
}
