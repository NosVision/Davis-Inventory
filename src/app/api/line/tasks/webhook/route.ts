import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { replyMessage } from '@/lib/line/messaging';
import { getTaskBotConfig } from '@/lib/line/tasks-bot';

// Webhook for the CENTRAL task bot (its own LINE channel — NOT the per-store customer OAs, which
// use /api/line/webhook and resolve a store from `destination`). This bot is push-only in normal
// use; the only inbound job here is helping an admin capture a group id: invite the bot to a LINE
// group and type "groupid" → it replies with the raw id (long-press to copy). Also replies on join.

interface LineEvent {
  type: string;
  replyToken?: string;
  source: { type: string; userId?: string; groupId?: string };
  message?: { type: string; text?: string };
}
interface LineWebhookBody { destination?: string; events?: LineEvent[] }

const GROUP_ID_KEYWORDS: RegExp[] = [
  /^group\s*id$/i,
  /^groupid$/i,
  /^\/group\s*id$/i,
  /^\/groupid$/i,
  /^id\s*กลุ่ม$/i,
  /^กลุ่ม\s*id$/i,
  /^ขอ\s*group\s*id$/i,
  /^ขอ\s*id\s*กลุ่ม$/i,
];
const isGroupIdKeyword = (text: string) => {
  const t = text.trim();
  return !!t && GROUP_ID_KEYWORDS.some((re) => re.test(t));
};

function verifySignature(body: string, signature: string, secret: string): boolean {
  const hash = crypto.createHmac('SHA256', secret).update(body).digest('base64');
  return hash === signature;
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('x-line-signature') || '';

  let parsed: LineWebhookBody;
  try {
    parsed = JSON.parse(body) as LineWebhookBody;
  } catch {
    return NextResponse.json({ status: 'ignored', reason: 'invalid_json' });
  }

  // Verify ping / empty delivery (LINE Console "Verify" button) → always 200.
  if (!parsed.events || parsed.events.length === 0) {
    return NextResponse.json({ status: 'ok', reason: 'no_events' });
  }

  const { token, secret } = await getTaskBotConfig();
  if (!token) {
    // Bot not configured yet — acknowledge so Verify passes during setup.
    return NextResponse.json({ status: 'ok', reason: 'bot_not_configured' });
  }
  // Verify with the central secret when set; run unverified only while the secret is still blank
  // (so the LINE Console Verify button passes mid-setup — same grace as the customer webhook).
  if (secret && !verifySignature(body, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  for (const event of parsed.events) {
    try {
      if (event.type === 'join' && event.source.groupId && event.replyToken) {
        await replyMessage(
          event.replyToken,
          [{ type: 'text', text: `✅ บอทงานเข้ากลุ่มแล้ว\n\n📋 Group ID:\n${event.source.groupId}\n\nนำ Group ID นี้ไปวางในตั้งค่าห้องงาน → แจ้งเตือน LINE` }],
          token
        );
      } else if (event.type === 'message' && event.message?.type === 'text' && event.replyToken) {
        const text = event.message.text || '';
        if (isGroupIdKeyword(text)) {
          const groupId = event.source.groupId;
          if (!groupId || event.source.type !== 'group') {
            await replyMessage(
              event.replyToken,
              [{ type: 'text', text: 'ℹ️ คำสั่ง "groupid" ใช้ได้ในกลุ่ม LINE เท่านั้น\n\nเชิญบอทงานเข้ากลุ่มก่อน แล้วพิมพ์ "groupid" ในกลุ่มนั้น' }],
              token
            );
          } else {
            // Two bubbles: a labelled one + the raw id alone (easiest to long-press & copy).
            await replyMessage(
              event.replyToken,
              [
                { type: 'text', text: `📋 Group ID ของกลุ่มนี้ (ก็อปด้านล่าง):` },
                { type: 'text', text: groupId },
              ],
              token
            );
          }
        }
      }
    } catch (error) {
      console.error('[tasks/line webhook] event error:', error);
    }
  }

  return NextResponse.json({ status: 'ok' });
}
