'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  Clock,
  CalendarDays,
  CalendarClock,
  CalendarX,
  Repeat,
  Receipt,
  Wallet,
  Star,
  Award,
  AlertTriangle,
  Gauge,
  Megaphone,
  BookOpen,
  UserCog,
  CalendarPlus,
  Timer,
  FileText,
  DoorOpen,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { RequiredPolicyBanner } from './_components/required-policy-banner';
import { MeSummary } from './_components/me-summary';

// Staff ESS home (P5.3) — the personal hub that makes every /me/* self-service surface reachable
// in one place (these pages were previously only reachable by URL). Self-contained locale strings,
// matching the other ESS pages. Tiles are plain links; each target page enforces its own auth.
interface Tile { key: string; icon: LucideIcon; href: string; color: string }

const TILES: Tile[] = [
  { key: 'checkin', icon: Clock, href: '/me/checkin', color: 'teal' },
  { key: 'schedule', icon: CalendarDays, href: '/me/schedule', color: 'indigo' },
  { key: 'timesheet', icon: CalendarClock, href: '/me/timesheet', color: 'indigo' },
  { key: 'attendanceRequests', icon: CalendarPlus, href: '/me/attendance-requests', color: 'sky' },
  { key: 'otRequests', icon: Timer, href: '/me/ot-requests', color: 'amber' },
  { key: 'leaves', icon: CalendarX, href: '/me/leaves', color: 'rose' },
  { key: 'swaps', icon: Repeat, href: '/me/swaps', color: 'violet' },
  { key: 'claims', icon: Receipt, href: '/me/claims', color: 'emerald' },
  { key: 'payslips', icon: Wallet, href: '/me/payslips', color: 'emerald' },
  { key: 'documents', icon: FileText, href: '/me/documents', color: 'sky' },
  { key: 'evaluations', icon: Star, href: '/me/evaluations', color: 'amber' },
  { key: 'evaluationResults', icon: Award, href: '/me/evaluation-results', color: 'violet' },
  { key: 'warnings', icon: AlertTriangle, href: '/me/warnings', color: 'rose' },
  { key: 'stockPenalties', icon: Gauge, href: '/me/stock-penalties', color: 'rose' },
  { key: 'announcements', icon: Megaphone, href: '/me/announcements', color: 'sky' },
  { key: 'policies', icon: BookOpen, href: '/me/policies', color: 'teal' },
  { key: 'resignation', icon: DoorOpen, href: '/me/offboarding', color: 'rose' },
  { key: 'profile', icon: UserCog, href: '/me/profile', color: 'indigo' },
];

const COLOR: Record<string, string> = {
  teal: 'bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400',
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
};

// 4-language tile labels (client ask 2026-07-21: Burmese/Lao staff must read every /me menu).
const LABELS: Record<string, { th: string; en: string; my: string; lo: string }> = {
  checkin: { th: 'เช็คอิน', en: 'Check-in', my: 'ချက်အင်', lo: 'ເຊັກອິນ' },
  schedule: { th: 'ตารางงาน', en: 'Schedule', my: 'အလုပ်ဇယား', lo: 'ຕາຕະລາງວຽກ' },
  timesheet: { th: 'บันทึกเวลา', en: 'Timesheet', my: 'အချိန်မှတ်တမ်း', lo: 'ບັນທຶກເວລາ' },
  attendanceRequests: { th: 'ขอแก้เวลา', en: 'Time requests', my: 'အချိန်ပြင်ရန်', lo: 'ຂໍແກ້ເວລາ' },
  otRequests: { th: 'ขอโอที', en: 'OT requests', my: 'OT တောင်းဆို', lo: 'ຂໍໂອທີ' },
  leaves: { th: 'ขอลา', en: 'Leave', my: 'ခွင့်တောင်း', lo: 'ຂໍລາ' },
  swaps: { th: 'สลับวันหยุด', en: 'Day-off swaps', my: 'အားလပ်ရက် လဲလှယ်', lo: 'ສະຫຼັບວັນພັກ' },
  claims: { th: 'เบิกค่าใช้จ่าย', en: 'Claims', my: 'စရိတ် တောင်းခံ', lo: 'ເບີກຄ່າໃຊ້ຈ່າຍ' },
  payslips: { th: 'สลิปเงินเดือน', en: 'Payslips', my: 'လစာစလစ်', lo: 'ສະລິບເງິນເດືອນ' },
  documents: { th: 'เอกสาร/50ทวิ', en: 'Documents', my: 'စာရွက်စာတမ်း', lo: 'ເອກະສານ' },
  evaluations: { th: 'ประเมินเพื่อน', en: 'Peer review', my: 'လုပ်ဖော်ကိုင်ဖက် အကဲဖြတ်', lo: 'ປະເມີນໝູ່ເພື່ອນ' },
  evaluationResults: { th: 'ผลประเมินของฉัน', en: 'My results', my: 'ကျွန်ုပ်၏ အကဲဖြတ်ချက်', lo: 'ຜົນປະເມີນຂອງຂ້ອຍ' },
  warnings: { th: 'ใบเตือน', en: 'Warnings', my: 'သတိပေးစာ', lo: 'ໃບເຕືອນ' },
  stockPenalties: { th: 'คะแนน/ค่าปรับสต๊อก', en: 'Stock penalties', my: 'စတော့ ဒဏ်ကြေး', lo: 'ຄະແນນ/ຄ່າປັບສະຕັອກ' },
  announcements: { th: 'ประกาศ', en: 'Announcements', my: 'ကြေညာချက်', lo: 'ປະກາດ' },
  policies: { th: 'ระเบียบบริษัท', en: 'Policies', my: 'ကုမ္ပဏီစည်းမျဉ်း', lo: 'ລະບຽບບໍລິສັດ' },
  resignation: { th: 'ยื่นลาออก', en: 'Resignation', my: 'နုတ်ထွက်စာ', lo: 'ຍື່ນລາອອກ' },
  profile: { th: 'โปรไฟล์', en: 'Profile', my: 'ပရိုဖိုင်', lo: 'ໂປຣໄຟລ໌' },
};

export default function MeHomePage() {
  const locale = useLocale();
  const label = (t: { th: string; en: string; my: string; lo: string }) =>
    locale === 'th' ? t.th : locale === 'my' ? t.my : locale === 'lo' ? t.lo : t.en;
  const title = label({ th: 'ของฉัน', en: 'My workspace', my: 'ကျွန်ုပ်', lo: 'ຂອງຂ້ອຍ' });
  const subtitle = label({
    th: 'บริการพนักงาน — เวลา ลางาน สลิป และประเมินผล',
    en: 'Employee self-service — time, leave, payslips, and reviews',
    my: 'ဝန်ထမ်း ကိုယ်တိုင်ဝန်ဆောင်မှု — အချိန်၊ ခွင့်၊ လစာစလစ်',
    lo: 'ບໍລິການພະນັກງານ — ເວລາ ລາພັກ ສະລິບ ແລະ ປະເມີນຜົນ',
  });

  // Per-tile "new activity" counts (unread notifications + must-act items).
  const [badges, setBadges] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/hr/ess/badges');
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setBadges((json.badges ?? {}) as Record<string, number>);
      } catch {
        /* badges are best-effort — never block the hub */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeader title={title} subtitle={subtitle} />

      <RequiredPolicyBanner />

      <MeSummary />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {TILES.map(({ key, icon: Icon, href, color }) => {
          const count = badges[key] ?? 0;
          return (
            <Link
              key={key}
              href={href}
              className="relative flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-teal-300 hover:bg-teal-50/40 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-teal-700 dark:hover:bg-teal-900/10"
            >
              {count > 0 && (
                <span className="absolute right-2 top-2 inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white shadow-sm">
                  {count > 99 ? '99+' : count}
                </span>
              )}
              <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', COLOR[color])}>
                <Icon className="h-5 w-5" />
              </div>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{label(LABELS[key])}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
