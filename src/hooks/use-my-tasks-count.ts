'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth-store';

/**
 * จำนวนงานที่ต้องการความสนใจจากผู้ใช้คนนี้ในระบบ "ห้องงาน" (ขับ badge บน sidebar/bottom-nav)
 * = งานที่มอบหมายให้ตัวเองแล้วแต่ยังไม่ได้ตอบกลับ + งานเปิดให้รับ (claim) ที่ตรงกลุ่มเป้าหมายของห้อง
 *
 * คำนวณฝั่ง server (`/api/tasks/my-count`) เพื่อใช้ logic เทียบกลุ่มเป้าหมายชุดเดียวกับ
 * resolve-target.ts — ไม่ทำซ้ำฝั่ง client เพื่อกันไม่ให้ logic สองจุดเพี้ยนไปคนละทาง
 */
export function useMyTasksCount(pollMs = 60_000): number {
  const { user } = useAuthStore();
  const [count, setCount] = useState(0);
  const fetchRef = useRef<() => void>(() => {});

  const fetchCount = useCallback(async () => {
    if (!user) {
      setCount(0);
      return;
    }
    try {
      const res = await fetch('/api/tasks/my-count');
      if (!res.ok) return;
      const data = await res.json();
      setCount(typeof data.count === 'number' ? data.count : 0);
    } catch {
      // เงียบไว้ — badge แค่ไม่อัปเดตรอบนี้ ไม่ใช่ error ที่ต้องแจ้งผู้ใช้
    }
  }, [user]);

  useEffect(() => {
    fetchRef.current = fetchCount;
  }, [fetchCount]);

  useEffect(() => {
    if (!user) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!document.hidden) fetchRef.current();
      }, 600);
    };

    fetchRef.current();

    // ── Realtime: refetch เมื่องาน/ผู้รับผิดชอบเปลี่ยนแปลง ──
    const supabase = createClient();
    const channel = supabase
      .channel('my-tasks-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees' }, debouncedFetch)
      .subscribe();

    const interval = setInterval(() => {
      if (!document.hidden) fetchRef.current();
    }, pollMs);

    const onFocus = () => {
      if (!document.hidden) fetchRef.current();
    };
    const onVisibility = () => {
      if (!document.hidden) fetchRef.current();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      supabase.removeChannel(channel);
    };
  }, [user, pollMs]);

  return count;
}
