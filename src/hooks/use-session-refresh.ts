'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Hook ที่จัดการ session refresh เมื่อกลับมาจากการพับจอ/ปิดหน้าจอ
 * - ฟัง visibilitychange event
 * - เมื่อ tab กลับมา visible → เรียก getUser() เพื่อ trigger token refresh
 * - ถ้า session หมดอายุจริง (refresh token expired / ไม่มี session) → redirect ไป login
 * - ถ้าแค่เน็ตหลุดตอนพับจอ (fetch ล้มเหลว / 5xx) → ปล่อยไว้ ให้ผู้ใช้ทำงานต่อ (2026-09-19:
 *   a phone that wakes before its Wi-Fi does used to get bounced to /login mid-shift)
 */
type AuthErrorLike = { name?: string; status?: number; code?: string };

/**
 * True only when the server has said the session is gone — not when the server could not be
 * reached. supabase-js reports the latter as AuthRetryableFetchError (status 0 or 5xx).
 */
function isDefinitiveAuthFailure(error: AuthErrorLike): boolean {
  if (error.name === 'AuthRetryableFetchError') return false;
  if (error.name === 'AuthSessionMissingError') return true;
  const status = error.status ?? 0;
  if (status >= 500 || status === 0) return false;
  return status === 401 || status === 403 || error.code === 'refresh_token_not_found' || status === 400;
}

export function useSessionRefresh() {
  const router = useRouter();
  // Stamped inside the effect: the render itself stays pure (react-hooks/purity).
  const lastRefresh = useRef(0);

  useEffect(() => {
    const supabase = createClient();
    lastRefresh.current = Date.now();

    async function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;

      // ไม่ต้อง refresh ถ้าเพิ่ง refresh ไปไม่ถึง 30 วินาที
      const elapsed = Date.now() - lastRefresh.current;
      if (elapsed < 30_000) return;

      lastRefresh.current = Date.now();

      const { error } = await supabase.auth.getUser();
      if (error && isDefinitiveAuthFailure(error)) {
        // Session หมดอายุจริง → redirect ไป login
        router.replace('/login');
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [router]);
}
