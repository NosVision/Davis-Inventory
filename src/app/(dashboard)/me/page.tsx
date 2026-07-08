'use client';

import Link from 'next/link';
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
  Megaphone,
  BookOpen,
  UserCog,
  CalendarPlus,
  Timer,
  FileText,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { RequiredPolicyBanner } from './_components/required-policy-banner';

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
  { key: 'announcements', icon: Megaphone, href: '/me/announcements', color: 'sky' },
  { key: 'policies', icon: BookOpen, href: '/me/policies', color: 'teal' },
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

const LABELS: Record<string, { th: string; en: string }> = {
  checkin: { th: 'เช็คอิน', en: 'Check-in' },
  schedule: { th: 'ตารางงาน', en: 'Schedule' },
  timesheet: { th: 'บันทึกเวลา', en: 'Timesheet' },
  attendanceRequests: { th: 'ขอแก้เวลา', en: 'Time requests' },
  otRequests: { th: 'ขอโอที', en: 'OT requests' },
  leaves: { th: 'ขอลา', en: 'Leave' },
  swaps: { th: 'สลับวันหยุด', en: 'Day-off swaps' },
  claims: { th: 'เบิกค่าใช้จ่าย', en: 'Claims' },
  payslips: { th: 'สลิปเงินเดือน', en: 'Payslips' },
  documents: { th: 'เอกสาร/50ทวิ', en: 'Documents' },
  evaluations: { th: 'ประเมินเพื่อน', en: 'Peer review' },
  evaluationResults: { th: 'ผลประเมินของฉัน', en: 'My results' },
  warnings: { th: 'ใบเตือน', en: 'Warnings' },
  announcements: { th: 'ประกาศ', en: 'Announcements' },
  policies: { th: 'ระเบียบบริษัท', en: 'Policies' },
  profile: { th: 'โปรไฟล์', en: 'Profile' },
};

export default function MeHomePage() {
  const isTh = useLocale() === 'th';
  const title = isTh ? 'ของฉัน' : 'My workspace';
  const subtitle = isTh ? 'บริการพนักงาน — เวลา ลางาน สลิป และประเมินผล' : 'Employee self-service — time, leave, payslips, and reviews';

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeader title={title} subtitle={subtitle} />

      <RequiredPolicyBanner />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {TILES.map(({ key, icon: Icon, href, color }) => (
          <Link
            key={key}
            href={href}
            className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-teal-300 hover:bg-teal-50/40 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-teal-700 dark:hover:bg-teal-900/10"
          >
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', COLOR[color])}>
              <Icon className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-gray-900 dark:text-white">{isTh ? LABELS[key].th : LABELS[key].en}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
