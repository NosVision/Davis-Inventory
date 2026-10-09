import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export interface SessionUser {
  id: string;
  email?: string;
}

/**
 * The signed-in user, read from the session JWT verified locally (ES256, JWKS cached per
 * instance) — a drop-in for `supabase.auth.getUser()` in server code, same `{ data: { user } }`
 * shape. getUser() asks the Auth server on every call; across ~140 API routes that was the single
 * biggest request at the 17:30 shift-start peak (1,027 calls in 12 min, ~23% of server time) and it
 * timed out with everything else when the database saturated (2026-10-09).
 *
 * Same trust as RLS: PostgREST also accepts any unexpired signed JWT. A signed-out or deleted
 * session stays usable until its token expires (≤1 h). Disabled staff are stopped by
 * `profiles.active`, which is a database read and unaffected. Keep `getUser()` where a revoked
 * session must be refused at once (password change, user administration).
 */
export async function getSessionUser(supabase: { auth: Pick<SupabaseClient['auth'], 'getClaims'> }) {
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const user: SessionUser | null =
    !error && claims?.sub
      ? { id: claims.sub, email: typeof claims.email === 'string' && claims.email ? claims.email : undefined }
      : null;
  return { data: { user }, error };
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component — ignore
          }
        },
      },
    }
  );
}

export function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() { return []; },
        setAll() {},
      },
    }
  );
}
