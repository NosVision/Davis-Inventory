'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { LogIn, Eye, EyeOff, Loader2 } from 'lucide-react';

/**
 * Where to go once signed in. The middleware puts the page it bounced from in ?redirect=; only a
 * same-origin path is honoured, so a crafted link cannot send a fresh login off-site.
 */
function postLoginHome(): string {
  const target = new URLSearchParams(window.location.search).get('redirect') ?? '';
  return target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/login') ? target : '/';
}

const DISABLED_MESSAGE = 'บัญชีนี้ถูกปิดใช้งานแล้ว — เข้าสู่ระบบด้วยบัญชีที่ใช้งานอยู่ หรือติดต่อ HR';

/**
 * Only an active profile may be forwarded into the app. The dashboard layout sends an inactive one
 * back here, and this page used to send any live session straight back in — an endless bounce the
 * phone shows as a flickering screen, with no chance to type a different account (HR report
 * 2026-10-05: a duplicate self-registration was disabled and its owner was locked out). An inactive
 * account is signed out on this device instead, so the form stays put.
 */
async function isActiveAccount(supabase: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('profiles').select('active').eq('id', userId).maybeSingle();
  return !error && data?.active === true;
}

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations('auth');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Already signed in (a stale tab, the PWA reopening on its start URL, a poll that bounced here
  // during a blip) → straight back in. getUser(), not getSession(): the server must confirm the
  // session, or an expired one would ping-pong between here and the middleware.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data, error: authError } = await supabase.auth.getUser();
        if (!alive || !data.user || authError) return;
        if (await isActiveAccount(supabase, data.user.id)) {
          if (alive) router.replace(postLoginHome());
          return;
        }
        await supabase.auth.signOut({ scope: 'local' });
        if (alive) setError(DISABLED_MESSAGE);
      } catch {
        /* offline — show the form; the submit path reports its own errors */
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!identifier.trim()) {
      setError(t('requiredUsername'));
      return;
    }
    if (!password) {
      setError(t('requiredPassword'));
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();
      const trimmed = identifier.trim().toLowerCase();
      const email = trimmed.includes('@') ? trimmed : `${trimmed}@stockmanager.app`;

      const { data: signIn, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        if (authError.message.includes('Invalid login credentials')) {
          setError(t('invalidCredentials'));
        } else if (authError.message.includes('Email not confirmed')) {
          setError(t('emailNotConfirmed'));
        } else {
          setError(t('loginError'));
        }
        return;
      }

      // The right password on a disabled account: say so here rather than bounce off the app.
      if (!signIn.user || !(await isActiveAccount(supabase, signIn.user.id))) {
        await supabase.auth.signOut({ scope: 'local' });
        setError(DISABLED_MESSAGE);
        return;
      }

      router.push(postLoginHome());
      router.refresh();
    } catch {
      setError(t('networkError'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleLogin}>
      {/* Error Alert */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Username */}
      <div className="mb-4">
        <label
          htmlFor="username"
          className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t('usernameOrEmail')}
        </label>
        <input
          id="username"
          type="text"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder={t('enterUsername')}
          autoComplete="username"
          disabled={isLoading}
          className={cn(
            'w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition-colors',
            'placeholder:text-gray-400',
            'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20',
            'disabled:cursor-not-allowed disabled:opacity-60',
            'dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500',
            'dark:focus:border-indigo-400 dark:focus:ring-indigo-400/20'
          )}
        />
      </div>

      {/* Password */}
      <div className="mb-6">
        <label
          htmlFor="password"
          className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t('password')}
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('enterPassword')}
            autoComplete="current-password"
            disabled={isLoading}
            className={cn(
              'w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 pr-11 text-sm text-gray-900 outline-none transition-colors',
              'placeholder:text-gray-400',
              'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20',
              'disabled:cursor-not-allowed disabled:opacity-60',
              'dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500',
              'dark:focus:border-indigo-400 dark:focus:ring-indigo-400/20'
            )}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            tabIndex={-1}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isLoading}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors',
          'hover:bg-indigo-700 active:bg-indigo-800',
          'disabled:cursor-not-allowed disabled:opacity-60',
          'dark:bg-indigo-500 dark:hover:bg-indigo-600'
        )}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <LogIn className="h-4 w-4" />
        )}
        {isLoading ? t('loggingIn') : t('login')}
      </button>

      {/* Register info — staff must use an invite link */}
      <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
        ยังไม่มีบัญชี? ติดต่อ Owner หรือ Manager เพื่อขอลิงก์เชิญ
      </p>
    </form>
  );
}
