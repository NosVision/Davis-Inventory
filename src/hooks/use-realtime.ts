'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

type TableName =
  | 'deposits'
  | 'withdrawals'
  | 'comparisons'
  | 'notifications'
  | 'announcements'
  | 'transfers'
  | 'hq_deposits'
  | 'borrows'
  | 'pos_orders'
  | 'pos_order_items'
  | 'inv_stock_movements'
  | 'menu_items';

interface UseRealtimeOptions<T> {
  table: TableName;
  filter?: string;
  onInsert?: (payload: T) => void;
  onUpdate?: (payload: T) => void;
  onDelete?: (payload: T) => void;
  enabled?: boolean;
  /** Fold a burst of events into one callback per event type (trailing edge), e.g. a bar
   *  confirming ten deposits at close. 0 = deliver every event. */
  debounceMs?: number;
}

type EventType = 'INSERT' | 'UPDATE' | 'DELETE';

export function useRealtime<T extends Record<string, unknown> = Record<string, unknown>>({
  table,
  filter,
  onInsert,
  onUpdate,
  onDelete,
  enabled = true,
  debounceMs = 0,
}: UseRealtimeOptions<T>) {
  // Callers pass inline arrows (`onUpdate: () => loadAll()`), which are new functions on every
  // render. With the callbacks in the effect's dependency list, every render tore the channel down
  // and joined again — a realtime.subscription insert + delete per state change on pages like
  // bar-approval (2026-10-10). Refs keep the subscription for the life of the table/filter.
  const handlers = useRef({ onInsert, onUpdate, onDelete });
  useEffect(() => {
    handlers.current = { onInsert, onUpdate, onDelete };
  }, [onInsert, onUpdate, onDelete]);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    const timers: Partial<Record<EventType, ReturnType<typeof setTimeout>>> = {};
    const dispatch = (type: EventType, row: T) => {
      const run = () => {
        const h = handlers.current;
        if (type === 'INSERT') h.onInsert?.(row);
        else if (type === 'UPDATE') h.onUpdate?.(row);
        else h.onDelete?.(row);
      };
      if (debounceMs <= 0) {
        run();
        return;
      }
      const pending = timers[type];
      if (pending) clearTimeout(pending);
      timers[type] = setTimeout(run, debounceMs);
    };

    const channel = supabase
      .channel(`realtime-${table}`)
      .on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table,
          ...(filter ? { filter } : {}),
        },
        (payload: RealtimePostgresChangesPayload<T>) => {
          if (payload.eventType === 'INSERT') dispatch('INSERT', payload.new as T);
          else if (payload.eventType === 'UPDATE') dispatch('UPDATE', payload.new as T);
          else if (payload.eventType === 'DELETE') dispatch('DELETE', payload.old as T);
        }
      )
      .subscribe();

    return () => {
      for (const t of Object.values(timers)) if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [table, filter, enabled, debounceMs]);
}
