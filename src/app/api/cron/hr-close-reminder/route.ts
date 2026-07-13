import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { openBusinessDateBangkok } from '@/lib/utils/date';
import { notifyHrManagers } from '@/lib/hr/notify';

// GET /api/cron/hr-close-reminder — daily nudge to HR about the monthly-close rhythm. Triggered by a
// Supabase pg_cron job once a day (~09:00 Asia/Bangkok); the endpoint decides from the day-of-month
// whether there is anything to remind about, so a single job covers every date-based reminder.
//   day 10       → evaluation results cut off today (before SV goes out on the 15th)
//   day 13 & 14  → close + allocate the previous month's SV pool before the 15th
//   day 26       → start this month's payroll and send the accountant the tax link (26–29)
//   day 30       → finalize payroll before month end (30/31)
// Reminders go to HR (owners / role 'hr' / can_manage_hr) via the in-app + PWA notification bell.
export async function GET(request: NextRequest) {
  const service = createServiceClient();

  // Auth: Vercel CRON_SECRET (if set) OR the Supabase-managed secret, so pg_cron can call it
  // without any Vercel env var (same pattern as the attendance reminder).
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let authorized = !!process.env.CRON_SECRET && token === process.env.CRON_SECRET;
  if (!authorized) {
    const { data: sec } = await service
      .from('cron_secrets')
      .select('secret')
      .eq('name', 'hr_close_reminder')
      .maybeSingle();
    authorized = !!sec?.secret && token === (sec.secret as string);
  }
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Day-of-month in Bangkok. At ~09:00 the business-date helper (06:00 cutoff) already returns
  // today's calendar date, so its day component is the Bangkok day-of-month.
  const dom = Number(openBusinessDateBangkok().slice(8, 10));

  // `key` selects the notificationTemplates.closeReminder.<key> message for render-time i18n; the
  // literal title/body remain the push text + fallback.
  const reminders: { key: string; title: string; body: string }[] = [];
  if (dom === 10) {
    reminders.push({
      key: 'evalCutoff',
      title: 'ตัดผลประเมินวันนี้',
      body: 'วันนี้วันที่ 10 — ปิดรับผลประเมินประจำเดือน ก่อนออก Service Charge วันที่ 15',
    });
  }
  if (dom === 13 || dom === 14) {
    reminders.push({
      key: 'svClose',
      title: 'ถึงเวลาปิดกอง SV',
      body: 'ปิด + จัดสรรกอง Service Charge เดือนก่อนให้เสร็จภายในวันที่ 15 (ก่อนจ่าย SV)',
    });
  }
  if (dom === 26) {
    reminders.push({
      key: 'payroll',
      title: 'ถึงเวลาทำเงินเดือน',
      body: 'เริ่มสร้างรอบเงินเดือน + ส่งลิงก์ให้บัญชีกรอกภาษี (ช่วงวันที่ 26–29)',
    });
  }
  if (dom === 30) {
    reminders.push({
      key: 'finalize',
      title: 'ใกล้สิ้นเดือน — ปิดยอดเงินเดือน',
      body: 'ตรวจทาน + ปิดยอดเงินเดือน และเตรียมไฟล์โอนธนาคารให้เสร็จภายในสิ้นเดือน',
    });
  }

  if (reminders.length === 0) {
    return NextResponse.json({ ok: true, day: dom, sent: 0 });
  }

  for (const r of reminders) {
    await notifyHrManagers(service, {
      storeId: null,
      type: 'hr_close_reminder',
      title: r.title,
      body: r.body,
      titleKey: `notificationTemplates.closeReminder.${r.key}.title`,
      bodyKey: `notificationTemplates.closeReminder.${r.key}.body`,
      data: { url: '/hr/close', day: dom },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, day: dom, sent: reminders.length });
}
