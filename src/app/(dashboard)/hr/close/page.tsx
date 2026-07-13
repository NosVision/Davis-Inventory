'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  CalendarClock,
  Star,
  Coins,
  AlertTriangle,
  SlidersHorizontal,
  Lock,
  Wallet,
  FileCheck2,
  Banknote,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui';

// HR "ปิดยอดประจำเดือน / Monthly Close" hub (Phase 2). One place that makes the two things the
// old flow hid explicit: (1) the month RHYTHM — SV closes on the 1st–15th, payroll runs 26th–29th
// with the accountant, and everything locks by the 30th/31st; (2) the N−1 OFFSET — the salary run
// for month N carries the Service-Charge pool of month N−1. Each stage deep-links to the real page
// that owns it, so a full close is one scroll instead of ~10 hub-and-spoke tiles.

type Lang = 'th' | 'en';
const TH = 'th';

function tt(lang: Lang, th: string, en: string): string {
  return lang === TH ? th : en;
}

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Human month label, e.g. "กรกฎาคม 2026" / "Jul 2026" (Buddhist year for TH). */
function monthLabel(lang: Lang, year: number, month1: number): string {
  const m = month1 - 1;
  return lang === TH ? `${MONTHS_TH[m]} ${year + 543}` : `${MONTHS_EN[m]} ${year}`;
}

interface Stage {
  n: number;
  icon: LucideIcon;
  th: string;
  en: string;
  period: 'N' | 'N-1';
  href: string;
  digestTh: string;
  digestEn: string;
}

export default function HrClosePage() {
  const lang = (useLocale() as Lang) === TH ? TH : 'en';
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);

  const period = useMemo(() => {
    const [y, m] = ym.split('-').map(Number);
    // Salary cycle for pay-month N = 26th of (N−1) → 25th of N. Pay on the last day of N.
    const startMonth = m === 1 ? 12 : m - 1;
    const startYear = m === 1 ? y - 1 : y;
    // SV pool carried in = the previous calendar month (N−1).
    const svMonth = m === 1 ? 12 : m - 1;
    const svYear = m === 1 ? y - 1 : y;
    const lastDay = new Date(y, m, 0).getDate();
    return {
      y,
      m,
      cycleStart: `26 ${monthLabel(lang, startYear, startMonth)}`,
      cycleEnd: `25 ${monthLabel(lang, y, m)}`,
      payDate: `${lastDay} ${monthLabel(lang, y, m)}`,
      svLabel: monthLabel(lang, svYear, svMonth),
      svPayDate: `15 ${monthLabel(lang, y, m)}`,
      qs: `?company=&month=${y}-${pad(m)}`,
      todayDom: now.getDate(),
    };
  }, [ym, lang, now]);

  const stages: Stage[] = [
    { n: 1, icon: CalendarClock, th: 'ตรวจเวลางาน', en: 'Attendance', period: 'N', href: '/hr/timesheet', digestTh: 'ยืนยันวัน/สาย/ลา/ขาด ของรอบนี้', digestEn: 'Verify days / late / leave / absent' },
    { n: 2, icon: Star, th: 'ปิดผลประเมิน', en: 'Evaluation', period: 'N-1', href: '/hr/evaluation', digestTh: 'ปิดงวดประเมินเดือนก่อน → ป้อน SV', digestEn: 'Close last month eval → feeds SV' },
    { n: 3, icon: Coins, th: 'ยอดกอง SV', en: 'SV pool', period: 'N-1', href: '/hr/service-charge', digestTh: 'กรอกยอด 7% ต่อร้าน (เดือนก่อน)', digestEn: 'Enter each store 7% pool (last month)' },
    { n: 4, icon: AlertTriangle, th: 'หักจาก HQ', en: 'HQ deductions', period: 'N-1', href: '/hr/stock-deductions', digestTh: 'ค่าปรับสต๊อก + ใบเตือน → หัก SV', digestEn: 'Stock fines + warnings → dock SV' },
    { n: 5, icon: SlidersHorizontal, th: 'จัดสรร + คำนวณ SV', en: 'Allocate + recompute', period: 'N-1', href: '/hr/service-charge', digestTh: 'หยอดรายคน แล้วคำนวณหักลา ÷30', digestEn: 'Allocate per person, recompute leave dock' },
    { n: 6, icon: Lock, th: 'ล็อกกอง SV', en: 'Finalize SV', period: 'N-1', href: '/hr/service-charge', digestTh: 'ล็อกทุกร้านก่อนสร้างรอบเงินเดือน', digestEn: 'Lock all stores before generating payroll' },
    { n: 7, icon: Wallet, th: 'สร้างรอบเงินเดือน', en: 'Generate payroll', period: 'N', href: '/hr/payroll', digestTh: 'ดึง SV เดือนก่อน (N−1) เข้าสลิป', digestEn: 'Pulls last month SV (N−1) into slips' },
    { n: 8, icon: FileCheck2, th: 'ตรวจทาน + ส่งบัญชี', en: 'Review + accountant', period: 'N', href: '/hr/payroll', digestTh: '26–29 ส่งลิงก์บัญชีกรอกภาษี แล้วปิดยอด', digestEn: '26–29 send accountant tax link, then lock' },
    { n: 9, icon: Banknote, th: 'ไฟล์ธนาคาร + ประกาศ', en: 'Bank file + announce', period: 'N', href: '/hr/payroll', digestTh: '30/31 โหลด CSV โอนเงิน + แจ้งพนักงาน', digestEn: '30/31 download transfer CSV + announce' },
  ];

  const rhythm = [
    { grow: 15, tone: 'sv', dTh: '1–15', dEn: '1–15', lTh: 'ปิดกอง SV เดือนก่อน (N−1)', lEn: 'Close last month SV (N−1)' },
    { grow: 10, tone: 'wait', dTh: '16–25', dEn: '16–25', lTh: 'รอรอบเวลางานปิด (25)', lEn: 'Wait for cycle close (25)' },
    { grow: 4, tone: 'pay', dTh: '26–29', dEn: '26–29', lTh: 'ทำเงินเดือน + ส่งบัญชี', lEn: 'Run payroll + accountant' },
    { grow: 3, tone: 'deadline', dTh: '30/31', dEn: '30/31', lTh: 'ปิดยอด + จ่าย', lEn: 'Finalize + pay' },
  ];
  const toneClass: Record<string, string> = {
    sv: 'bg-teal-50 border-teal-300 text-teal-800 dark:bg-teal-900/25 dark:border-teal-700 dark:text-teal-200',
    wait: 'bg-gray-50 border-gray-200 text-gray-400 dark:bg-gray-800/50 dark:border-gray-700 dark:text-gray-500',
    pay: 'bg-indigo-50 border-indigo-300 text-indigo-800 dark:bg-indigo-900/25 dark:border-indigo-700 dark:text-indigo-200',
    deadline: 'bg-amber-50 border-amber-400 text-amber-800 dark:bg-amber-900/25 dark:border-amber-600 dark:text-amber-200',
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <PageHeader
        title={tt(lang, 'ปิดยอดประจำเดือน', 'Monthly Close')}
        subtitle={tt(lang, 'จัดการ Service Charge + เงินเดือน ในที่เดียว', 'Service charge + payroll close in one place')}
      />

      {/* month picker */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {tt(lang, 'เดือนจ่าย (N)', 'Pay month (N)')}
          </span>
          <input
            type="month"
            value={ym}
            onChange={(e) => setYm(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
      </div>

      {/* period chips: N and N−1 made explicit */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <span className="absolute inset-y-0 left-0 w-1 bg-indigo-500" />
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
            <span className="rounded-full bg-indigo-500 px-1.5 py-0.5 text-[10px] text-white">N</span>
            {tt(lang, 'เงินเดือน', 'Salary')} — {monthLabel(lang, period.y, period.m)}
          </div>
          <div className="mt-1 text-sm font-bold text-gray-900 dark:text-gray-100">
            {tt(lang, 'รอบ', 'Cycle')} {period.cycleStart} – {period.cycleEnd}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {tt(lang, 'จ่าย', 'Pay')} {period.payDate} · {tt(lang, 'หาร 30 · ปกส. 5% เพดาน 875', '÷30 · SSO 5% cap 875')}
          </div>
        </div>
        <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <span className="absolute inset-y-0 left-0 w-1 bg-teal-500" />
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-teal-600 dark:text-teal-300">
            <span className="rounded-full bg-teal-500 px-1.5 py-0.5 text-[10px] text-white">N−1</span>
            {tt(lang, 'SV ที่ยกมา', 'SV carried in')} — {period.svLabel}
          </div>
          <div className="mt-1 text-sm font-bold text-gray-900 dark:text-gray-100">
            {tt(lang, 'กอง Service Charge เดือนก่อน', 'Last month service-charge pool')}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {tt(lang, 'จ่ายแยก', 'Paid separately')} {period.svPayDate} · {tt(lang, 'โชว์ในสลิป ไม่รวม net', 'shown on slip, not in net')}
          </div>
        </div>
      </div>

      {/* month rhythm */}
      <div className="mb-6">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">
          {tt(lang, 'จังหวะทั้งเดือน', 'Month rhythm')}
        </div>
        <div className="flex gap-1.5">
          {rhythm.map((s, i) => (
            <div
              key={i}
              style={{ flexGrow: s.grow, flexBasis: 0 }}
              className={`min-w-0 rounded-lg border px-2.5 py-2 ${toneClass[s.tone]}`}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-extrabold tabular-nums">
                {lang === TH ? s.dTh : s.dEn}
                {s.tone === 'sv' && period.todayDom >= 1 && period.todayDom <= 15 && (
                  <span className="rounded-full bg-rose-500 px-1.5 text-[9px] font-bold text-white">
                    {tt(lang, `วันนี้ ${period.todayDom}`, `today ${period.todayDom}`)}
                  </span>
                )}
              </div>
              <div className="truncate text-[10.5px] font-semibold leading-tight">{lang === TH ? s.lTh : s.lEn}</div>
            </div>
          ))}
        </div>
      </div>

      {/* close timeline — deep links to the page that owns each stage */}
      <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {stages.map((s, i) => {
          const Icon = s.icon;
          return (
            <Link
              key={s.n}
              href={s.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                i < stages.length - 1 ? 'border-b border-gray-100 dark:border-gray-700/60' : ''
              }`}
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                {s.n}
              </div>
              <Icon className="h-4 w-4 flex-shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{lang === TH ? s.th : s.en}</span>
                  <span
                    className={`rounded px-1.5 text-[9px] font-extrabold ${
                      s.period === 'N'
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                        : 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
                    }`}
                  >
                    {s.period}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{lang === TH ? s.digestTh : s.digestEn}</div>
              </div>
              <ArrowRight className="h-4 w-4 flex-shrink-0 text-gray-300 dark:text-gray-600" />
            </Link>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs text-gray-400">
        {tt(
          lang,
          'SV/tip เดือน N−1 ไหลเข้าสลิปเดือน N (โชว์อ้างอิง) แต่จ่ายแยกวันที่ 15 · เงินเดือนปิดยอด 30/31',
          'N−1 SV/tips appear on the N payslip for reference but are paid separately on the 15th · salary locks on the 30th/31st'
        )}
      </p>
    </div>
  );
}
