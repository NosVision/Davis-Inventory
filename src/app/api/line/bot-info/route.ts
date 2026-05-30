import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/line/bot-info — server-side proxy to LINE's /v2/bot/info.
//
// Why this route exists: the browser CANNOT call api.line.me directly.
//   1. LINE's API sends no CORS headers, so a cross-origin fetch is blocked.
//   2. Our service worker (public/sw.js) intercepts the cross-origin GET and,
//      when the network call fails, returns a synthetic `503 Offline` — which
//      is the mysterious error operators saw on the "ดึงจาก LINE" button.
// Relaying server-to-server sidesteps both problems (and /api/* is already
// skipped by the service worker).
//
// Security: the caller supplies the channel access token they are about to
// save in store settings, so this is not a privilege escalation — we only
// require an authenticated user so the route can't be used as an open proxy.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let token: unknown;
  try {
    ({ token } = (await req.json()) as { token?: unknown });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof token !== 'string' || !token.trim()) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  let lineRes: Response;
  try {
    lineRes = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${token.trim()}` },
      cache: 'no-store',
    });
  } catch (err) {
    // LINE unreachable from our server (network / DNS). 502 = upstream issue,
    // deliberately NOT 401 so the client doesn't confuse it with app auth.
    return NextResponse.json(
      {
        error: 'ติดต่อ LINE ไม่สำเร็จ',
        detail: err instanceof Error ? err.message : 'network error',
      },
      { status: 502 },
    );
  }

  const raw = await lineRes.text().catch(() => '');

  if (!lineRes.ok) {
    // Surface LINE's real status (e.g. 401 = bad token) in the body so the
    // client can show a precise hint, but respond 502 ourselves to keep our
    // own auth semantics clean.
    return NextResponse.json(
      { error: 'LINE ปฏิเสธคำขอ', lineStatus: lineRes.status, detail: raw.slice(0, 200) },
      { status: 502 },
    );
  }

  let info: { userId?: string; basicId?: string; displayName?: string; pictureUrl?: string };
  try {
    info = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'LINE ตอบกลับไม่ถูกรูปแบบ' }, { status: 502 });
  }

  if (!info.userId) {
    return NextResponse.json({ error: 'LINE ไม่ได้ส่ง userId กลับมา' }, { status: 502 });
  }

  // Pass through only the fields the client needs (no token echoed back).
  return NextResponse.json({
    userId: info.userId,
    basicId: info.basicId ?? null,
    displayName: info.displayName ?? null,
  });
}
