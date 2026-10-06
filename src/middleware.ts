import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { canAccessDashboardPath } from '@/lib/auth/settings-access';
import { canAccessDepositHistory } from '@/lib/deposit/history';

// Routes that bypass the Supabase session check entirely.
//
// The customer LIFF flow has no Supabase session — customers authenticate
// client-side via LIFF SDK (LINE access token) or via an HMAC-signed token
// in the URL. Each customer API verifies that proof itself, so the
// middleware just needs to get out of the way. If we redirect them to
// /login, the LIFF page can't even fetch the central LIFF id.
const PUBLIC_ROUTES = [
  '/login',
  '/invite',                     // /invite/[token] — staff invitation register page
  '/register',                   // /register/[token] — HR self-registration page
  '/api/auth/hr-register',       // token-gated staff self-registration (validates its own token)
  '/api/auth/invitation',        // /api/auth/invitation/[token] — public lookup
  '/api/auth/callback',
  '/api/auth/liff-verify',       // LIFF SDK access-token verify
  '/api/auth/customer-token',    // HMAC link verify
  '/api/line/webhook',           // per-store customer OAs
  '/api/line/tasks/webhook',     // central task bot — its own channel; verifies its own signature

  '/api/cron',
  '/api/chat/bot-message',
  '/api/system-settings/public', // central bot/LIFF id (whitelisted keys only)
  '/api/public',                 // /api/public/store-lookup etc.
  '/api/hr-checklist',           // owner saves checklist picks (no login); GET self-guards auth
  '/api/customer',               // /api/customer/* — each route does its own auth
  '/customer',                   // LIFF customer page itself
  '/review',                     // /review/[token] — accountant payrun review (token IS the auth)
  '/api/hr/payrun-review',       // token-gated payrun review API (hashed-token check inside)
];
const CUSTOMER_ROUTES = ['/customer'];
// The 'hr' role is denied these route trees (pages + their APIs).
const HR_BLOCKED_ROUTES = ['/deposit', '/stock', '/api/stock'];
const HQ_DEPOSIT_HISTORY_ROUTES = ['/hq/deposit-history', '/api/hq/deposit-history'];

function pathMatches(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/**
 * What "not signed in" looks like to the caller. A page navigation goes to /login; an API call
 * gets a 401 it can read. The distinction matters because the shell polls five APIs every
 * 45–60 s: when those were redirected too (fail-closed gate, 2026-09-10), one transient auth
 * hiccup on a poll turned into the whole app landing on /login mid-task. A fetch cannot follow
 * a redirect into a page anyway — all it saw was HTML where JSON was expected.
 */
function unauthenticated(request: NextRequest, pathname: string): NextResponse {
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', pathname);
  // Keep the installed-app launch marker (manifest start_url ?source=pwa) across the
  // redirect so the login page can stamp sessionStorage for the PWA gate.
  if (request.nextUrl.searchParams.get('source') === 'pwa') {
    loginUrl.searchParams.set('source', 'pwa');
  }
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // Allow static files
  if (pathname.startsWith('/_next') || pathname.startsWith('/icons') || pathname === '/manifest.json' || pathname === '/sw.js') {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Verify the session JWT locally against the project's ES256 signing key
  // (JWKS cached per isolate) instead of asking the Auth server on every
  // request. getUser() here was one Supabase round trip per page/API hit, and
  // at the 04:00 shift-end peak those calls queued behind a saturated database
  // until Vercel killed the middleware (504 MIDDLEWARE_INVOCATION_TIMEOUT).
  // A token is still refreshed through the Auth server when it expires.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  // No session → login page for a navigation, 401 for an API call
  if (!claims?.sub) return unauthenticated(request, pathname);

  // Role is mirrored from profiles.role into app_metadata by a trigger
  // (migration 20261006100000), so the JWT carries it. Falls back to a
  // profiles query only for a token issued before that copy existed.
  let role: string | null = (claims.app_metadata?.role as string) || null;

  if (!role) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', claims.sub)
      .single();

    if (!profile) return unauthenticated(request, pathname);
    role = profile.role;
  }

  if (!role) return unauthenticated(request, pathname);

  // Customer can only access /customer routes
  if (role === 'customer' && !CUSTOMER_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL('/customer', request.url));
  }

  // HR role: no access to the deposit ("ฝากเหล้า") or stock-count ("นับสต๊อก") systems.
  // The menu already hides them; this hard-blocks a direct URL / API hit.
  if (role === 'hr' && HR_BLOCKED_ROUTES.some((r) => pathname.startsWith(r))) {
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      : NextResponse.redirect(new URL('/hr', request.url));
  }

  // Deposit audit contains cross-branch staff activity and before/after values.
  // Only Owner and HQ may access it, independently of broader permissions.
  if (
    HQ_DEPOSIT_HISTORY_ROUTES.some((route) => pathMatches(pathname, route))
    && !canAccessDepositHistory(role)
  ) {
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      : NextResponse.redirect(new URL('/warehouse', request.url));
  }

  // System settings are restricted independently of menu visibility. Keep the
  // personal password and notification pages available to every signed-in role.
  if (!canAccessDashboardPath(role, pathname)) {
    return NextResponse.redirect(new URL('/warehouse', request.url));
  }

  // Non-customer cannot access /customer routes
  if (role !== 'customer' && CUSTOMER_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html)$).*)',
  ],
};
