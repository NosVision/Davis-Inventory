'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Inbox, ExternalLink, RefreshCw } from 'lucide-react';
import {
  Button,
  DataCard,
  DataList,
  PageHeader,
  Select,
  SkeletonList,
  StatusBadge,
  ViewToggle,
  useViewMode,
} from '@/components/ui';
import { EmployeeName } from '@/components/hr/employee-name';
import { useEssText } from '@/lib/i18n/ess-locale';
import { formatThaiDate, formatThaiDateTime } from '@/lib/utils/format';

/**
 * /hr/inbox — every item waiting on HR, of every type, across every company, in one list.
 *
 * Each request type has its own queue page, and each queue is per store — so a resignation, an OT
 * request and a bank-detail change for three people at three companies meant opening three pages
 * and walking each one company by company (คุณเมย์ 2026-09-08: "คำขอต้องเข้าไปไล่หาทีละบริษัท").
 * This page is the one place to look; deciding still happens on the type's own page, which the
 * row links to. Notifications for new requests land here with `?type=&id=` so the row they are
 * about is already highlighted.
 *
 * Strings are inline (useEssText) like the /me pages: this is one screen, not a catalog.
 */
type InboxType =
  | 'leave'
  | 'swap'
  | 'resignation'
  | 'offboarding_ack'
  | 'attendance_request'
  | 'ot'
  | 'profile_change'
  | 'claim'
  | 'document'
  | 'paper_slip'
  | 'identity_claim'
  | 'attendance_review';

const TYPE_ORDER: InboxType[] = [
  'resignation',
  'leave',
  'attendance_request',
  'ot',
  'swap',
  'claim',
  'profile_change',
  'document',
  'paper_slip',
  'identity_claim',
  'offboarding_ack',
  'attendance_review',
];

interface InboxRow {
  id: string;
  type: InboxType;
  user_id: string | null;
  store_id: string | null;
  company_id: string | null;
  submitted_at: string;
  date: string | null;
  note: string | null;
  employee_name: string | null;
  employee_nickname: string | null;
  employee_linked: boolean;
  company_name: string | null;
  store_name: string | null;
  href: string;
}

interface CompanyCount {
  company_id: string | null;
  name: string | null;
  count: number;
}

interface InboxPayload {
  items: InboxRow[];
  total: number;
  companies: CompanyCount[];
  types: Record<InboxType, number>;
}

type Tx = (th: string, en: string, my?: string, lo?: string) => string;

function typeLabel(tx: Tx, type: InboxType): string {
  switch (type) {
    case 'leave':
      return tx('ขอลา', 'Leave');
    case 'swap':
      return tx('สลับวันหยุด', 'Day-off swap');
    case 'resignation':
      return tx('ใบลาออก', 'Resignation');
    case 'offboarding_ack':
      return tx('รอพนักงานลงนามพ้นสภาพ', 'Offboarding signature');
    case 'attendance_request':
      return tx('ขอแก้เวลาเข้า-ออก', 'Time correction');
    case 'ot':
      return tx('ขอโอที', 'Overtime');
    case 'profile_change':
      return tx('ขอแก้ข้อมูลพนักงาน', 'Profile change');
    case 'claim':
      return tx('เบิกค่าใช้จ่าย', 'Expense claim');
    case 'document':
      return tx('ขอเอกสาร', 'Document request');
    case 'paper_slip':
      return tx('ขอสลิปกระดาษ', 'Paper slip');
    case 'identity_claim':
      return tx('ยืนยันตัวตน', 'Identity claim');
    case 'attendance_review':
      return tx('ลงเวลารอตรวจ', 'Punch review');
  }
}

/** The row's `note` is a code from the source table; this is what it means to a reader. */
function noteLabel(tx: Tx, row: InboxRow): string | null {
  const n = row.note;
  switch (row.type) {
    case 'attendance_request':
      return n === 'missing_in'
        ? tx('ลืมลงเวลาเข้า', 'Missing check-in')
        : n === 'missing_out'
          ? tx('ลืมลงเวลาออก', 'Missing check-out')
          : n === 'wrong_time'
            ? tx('เวลาไม่ถูกต้อง', 'Wrong time')
            : tx('อื่นๆ', 'Other');
    case 'ot':
      return n ? `${n} ${tx('นาที', 'min')}` : null;
    case 'profile_change':
      return n === 'bank_account'
        ? tx('บัญชีธนาคาร', 'Bank account')
        : n === 'emergency_contact'
          ? tx('ผู้ติดต่อฉุกเฉิน', 'Emergency contact')
          : n === 'full_name'
            ? tx('ชื่อ-นามสกุล', 'Legal name')
            : n;
    case 'claim':
      return n === 'travel'
        ? tx('ค่าเดินทาง', 'Travel')
        : n === 'medical'
          ? tx('ค่ารักษาพยาบาล', 'Medical')
          : n === 'supplies'
            ? tx('ค่าวัสดุ', 'Supplies')
            : n === 'equipment'
              ? tx('ค่าอุปกรณ์', 'Equipment')
              : tx('อื่นๆ', 'Other');
    case 'document':
      return n === 'cert_50twi'
        ? tx('ใบ 50 ทวิ', '50 Tawi certificate')
        : n === 'salary_cert'
          ? tx('หนังสือรับรองเงินเดือน', 'Salary certificate')
          : n === 'slip_copy'
            ? tx('สำเนาสลิป', 'Payslip copy')
            : tx('อื่นๆ', 'Other');
    case 'paper_slip':
      return n ? `${tx('งวด', 'Period')} ${n}` : null;
    case 'identity_claim':
      return n ? `${tx('อ้างชื่อ', 'Claims to be')}: ${n}` : null;
    case 'attendance_review':
      return n === 'in'
        ? tx('เข้างาน', 'Check-in')
        : n === 'out'
          ? tx('ออกงาน', 'Check-out')
          : n === 'break_start'
            ? tx('เริ่มพัก', 'Break start')
            : n === 'break_end'
              ? tx('จบพัก', 'Break end')
              : n;
    case 'swap':
      return n === 'ack'
        ? tx('สาขาอนุมัติแล้ว — รอ HR รับทราบ', 'Store approved — awaiting HR acknowledgement')
        : tx('รอตัดสิน — สาขาไม่มีผู้อนุมัติ', 'Awaiting decision — no store approver');
    case 'offboarding_ack':
      return n === 'termination' ? tx('เลิกจ้าง', 'Termination') : tx('ลาออก', 'Resignation');
    case 'leave':
    case 'resignation':
    default:
      return n;
  }
}

/** Preselection from a notification link: /hr/inbox?type=ot&id=… (or ?company_id= from the hub). */
function readQuery(): { type: string; companyId: string; id: string } {
  const p = new URLSearchParams(window.location.search);
  return { type: p.get('type') ?? '', companyId: p.get('company_id') ?? '', id: p.get('id') ?? '' };
}

export default function HrInboxPage() {
  const tx = useEssText();
  const [view, setView] = useViewMode('hr-inbox');

  const [companyId, setCompanyId] = useState('');
  const [type, setType] = useState('');
  const [highlightId, setHighlightId] = useState('');
  // The query string is read after mount (no Suspense boundary for useSearchParams) — until then
  // the page shows the unfiltered inbox, which is also what the hub tile opens.
  const [queryRead, setQueryRead] = useState(false);
  useEffect(() => {
    const q = readQuery();
    setCompanyId(q.companyId);
    setType(q.type);
    setHighlightId(q.id);
    setQueryRead(true);
  }, []);

  const [data, setData] = useState<InboxPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!queryRead) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('company_id', companyId);
      if (type) params.set('type', type);
      const res = await fetch(`/api/hr/inbox?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'failed');
      setData(json.data as InboxPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [queryRead, companyId, type]);

  useEffect(() => {
    load();
  }, [load]);

  // A tab that comes back after a while shows what is waiting now, not what was waiting then.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  // Bring the notified row into view once it is on screen.
  const highlightRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!loading && highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [loading, highlightId, data]);

  const items = data?.items ?? [];
  const highlightedGone = !loading && !!highlightId && !!data && !items.some((r) => r.id === highlightId);

  const companyOptions = useMemo(() => {
    const all = { value: '', label: `${tx('ทุกบริษัท', 'All companies')} (${data?.total ?? 0})` };
    const rest = (data?.companies ?? []).map((c) => ({
      value: c.company_id ?? 'none',
      label: `${c.name ?? tx('ไม่ระบุบริษัท', 'No company')} (${c.count})`,
    }));
    return [all, ...rest];
  }, [data, tx]);

  const typeOptions = useMemo(() => {
    const all = { value: '', label: tx('ทุกประเภท', 'All types') };
    const rest = TYPE_ORDER.map((t) => ({
      value: t,
      label: `${typeLabel(tx, t)} (${data?.types?.[t] ?? 0})`,
    }));
    return [all, ...rest];
  }, [data, tx]);

  const meta = (r: InboxRow) => {
    const parts = [r.store_name, r.company_name].filter(Boolean);
    return parts.length ? parts.join(' · ') : tx('ไม่ระบุสาขา/บริษัท', 'No venue / company');
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeader
        title={tx('กล่องคำขอทั้งหมด', 'Request inbox')}
        subtitle={tx(
          'ทุกคำขอที่รอ HR ดำเนินการ ทุกประเภท ทุกบริษัท ในหน้าเดียว — กดเปิดเพื่อไปตัดสินที่หน้าของประเภทนั้น',
          'Everything waiting on HR — every type, every company, one list. Open a row to decide it on its own page.'
        )}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => load()} icon={<RefreshCw className="h-4 w-4" />}>
              {tx('รีเฟรช', 'Refresh')}
            </Button>
            <ViewToggle value={view} onChange={setView} />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label={tx('บริษัท', 'Company')}
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          options={companyOptions}
        />
        <Select
          label={tx('ประเภทคำขอ', 'Request type')}
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={typeOptions}
        />
      </div>

      {highlightedGone && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/15 dark:text-emerald-300">
          {tx(
            'รายการที่แจ้งเตือนถูกดำเนินการไปแล้ว — ด้านล่างคือรายการที่ยังรออยู่',
            'The item from the notification has already been handled — below is what is still waiting.'
          )}
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/15 dark:text-red-300">
          {tx('โหลดรายการไม่สำเร็จ', 'Could not load the inbox')} — {error}
        </p>
      )}

      {!loading && !error && items.length > 0 && (
        <p className="text-xs opacity-70">
          {tx(`${items.length} รายการ`, `${items.length} item${items.length === 1 ? '' : 's'}`)}
          {companyId || type ? ` · ${tx('จากทั้งหมด', 'of')} ${data?.total ?? 0}` : ''}
        </p>
      )}

      {loading ? (
        <SkeletonList rows={6} />
      ) : items.length === 0 && !error ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
          <Inbox className="h-8 w-8" />
          {companyId || type
            ? tx('ไม่มีรายการรอในตัวกรองนี้', 'Nothing waiting under this filter')
            : tx('ไม่มีรายการค้าง — เคลียร์หมดแล้ว', 'All clear — nothing pending')}
        </div>
      ) : (
        <DataList compact={view === 'compact'}>
          {items.map((r) => {
            const isHighlight = r.id === highlightId;
            const detail = noteLabel(tx, r);
            return (
              <div key={`${r.type}:${r.id}`} ref={isHighlight ? highlightRef : undefined}>
                <DataCard
                  accent={isHighlight ? 'accent' : r.type === 'resignation' ? 'serious' : 'warn'}
                  className={isHighlight ? 'ring-2 ring-indigo-300 dark:ring-indigo-600' : undefined}
                  title={
                    <>
                      <EmployeeName name={r.employee_name ?? '—'} nickname={r.employee_nickname} />
                      {` · ${typeLabel(tx, r.type)}`}
                    </>
                  }
                  subtitle={meta(r)}
                  status={
                    <>
                      <StatusBadge tone={isHighlight ? 'info' : 'warn'} label={typeLabel(tx, r.type)} />
                      {!r.employee_linked && (
                        <StatusBadge tone="neutral" label={tx('ยังไม่ผูกประวัติพนักงาน', 'No employee record')} />
                      )}
                    </>
                  }
                  actions={
                    <Link
                      href={r.href}
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {tx('เปิดรายการ', 'Open')}
                    </Link>
                  }
                >
                  <p>
                    {r.date ? `${formatThaiDate(r.date)}` : null}
                    {r.date && detail ? ' · ' : null}
                    {detail}
                  </p>
                  <p className="text-xs opacity-70">
                    {tx('ยื่นเมื่อ', 'Submitted')} {formatThaiDateTime(r.submitted_at)}
                  </p>
                </DataCard>
              </div>
            );
          })}
        </DataList>
      )}
    </div>
  );
}
