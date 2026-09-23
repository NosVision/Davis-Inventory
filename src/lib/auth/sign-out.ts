'use client';

import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth-store';

/**
 * The one logout path for the app shell. It must end the Supabase session, not just clear the
 * client store: /login sends a signed-in visitor straight back home (8319bd4), so a logout that
 * left the cookie behind bounced the user back into the app (report 2026-09-23).
 *
 * scope 'local' ends this device's session only — staff sign in on a phone and a shared bar
 * tablet, and logging out of one must not kick the other.
 *
 * A full page load, not router.push: it drops the router cache and every in-memory query, so
 * nothing from the previous account survives into the next sign-in on a shared device.
 */
export async function signOutToLogin(): Promise<void> {
  let failed = false;
  try {
    const { error } = await createClient().auth.signOut({ scope: 'local' });
    if (error) {
      failed = true;
      console.error('[signOut] server sign-out failed; clearing the local session anyway', error);
    }
  } catch (err) {
    failed = true;
    console.error('[signOut] server sign-out threw; clearing the local session anyway', err);
  }
  // supabase-js keeps the session when the revoke call fails (offline, 5xx), which would bounce
  // straight back from /login. The user asked to leave this device, so drop its auth cookies.
  if (failed) clearSupabaseAuthCookies();
  useAuthStore.getState().logout();
  window.location.replace('/login');
}

/** Expire @supabase/ssr's session cookies (`sb-<ref>-auth-token`, plus its `.0`, `.1` chunks). */
function clearSupabaseAuthCookies(): void {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim();
    if (name && name.startsWith('sb-') && name.includes('-auth-token')) {
      document.cookie = `${name}=; Max-Age=0; path=/`;
    }
  }
}
