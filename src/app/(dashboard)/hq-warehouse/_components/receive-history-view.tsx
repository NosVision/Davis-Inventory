'use client';

/**
 * History tab body for /hq-warehouse — date-scoped list of receive
 * sessions, grouped by from-store, each session showing the items
 * confirmed together with the receiver and timestamp.
 *
 * Pure presentation: data-loading lives in the parent page so the same
 * loaders + realtime subscription stay in one place.
 */

import { useMemo } from 'react';
import {
  Calendar,
  ArrowLeft,
  ArrowRight,
  FileDown,
  Loader2,
  Inbox,
  Image as ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { todayBangkok } from '@/lib/utils/date';
import { formatThaiDate } from '@/lib/utils/format';

// Local copy of the page's HqDepositItem shape to avoid a circular
// import — only the fields this view actually reads.
export interface HistoryItem {
  id: string;
  from_store_id: string | null;
  from_store_name: string;
  product_name: string | null;
  customer_name: string | null;
  deposit_code: string | null;
  quantity: number | null;
  status: string;
  received_by: string | null;
  received_by_name: string | null;
  received_photo_url: string | null;
  received_at: string;
  received_session_id: string | null;
  notes: string | null;
}

interface Props {
  date: string;
  setDate: (d: string) => void;
  items: HistoryItem[];
  loading: boolean;
  hqName: string;
  searchQuery: string;
  downloading: boolean;
  onDownload: () => void;
}

interface Session {
  session_id: string;
  from_store_id: string | null;
  from_store_name: string;
  received_at: string;
  received_by_name: string | null;
  received_photo_url: string | null;
  items: HistoryItem[];
}

interface StoreGroup {
  from_store_name: string;
  total_items: number;
  sessions: Session[];
}

export function ReceiveHistoryView({
  date,
  setDate,
  items,
  loading,
  hqName,
  searchQuery,
  downloading,
  onDownload,
}: Props) {
  // Free-text filter — same fields the parent page already searches in
  // other tabs so the global search box behaves consistently.
  const filtered = useMemo(() => {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (i) =>
        i.product_name?.toLowerCase().includes(q) ||
        i.customer_name?.toLowerCase().includes(q) ||
        i.deposit_code?.toLowerCase().includes(q) ||
        i.from_store_name.toLowerCase().includes(q),
    );
  }, [items, searchQuery]);

  // Group: store → sessions. Items without a session_id (shouldn't
  // happen post-migration, but defensive) get bucketed by their own id.
  const groups = useMemo<StoreGroup[]>(() => {
    const sessionMap = new Map<string, Session>();
    for (const it of filtered) {
      const sid = it.received_session_id || `solo:${it.id}`;
      const existing = sessionMap.get(sid);
      if (existing) {
        existing.items.push(it);
      } else {
        sessionMap.set(sid, {
          session_id: sid,
          from_store_id: it.from_store_id,
          from_store_name: it.from_store_name,
          received_at: it.received_at,
          received_by_name: it.received_by_name,
          received_photo_url: it.received_photo_url,
          items: [it],
        });
      }
    }
    const sessions = Array.from(sessionMap.values()).sort(
      (a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime(),
    );
    const storeMap = new Map<string, StoreGroup>();
    for (const s of sessions) {
      const key = s.from_store_name;
      const cur = storeMap.get(key);
      if (cur) {
        cur.sessions.push(s);
        cur.total_items += s.items.length;
      } else {
        storeMap.set(key, {
          from_store_name: key,
          total_items: s.items.length,
          sessions: [s],
        });
      }
    }
    return Array.from(storeMap.values()).sort((a, b) =>
      a.from_store_name.localeCompare(b.from_store_name, 'th'),
    );
  }, [filtered]);

  const totalItems = filtered.length;
  const totalSessions = groups.reduce((sum, g) => sum + g.sessions.length, 0);

  const shiftDate = (delta: number) => {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    setDate(`${yyyy}-${mm}-${dd}`);
  };

  const today = todayBangkok();
  const isFutureDate = date >= today;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 p-4 text-white">
        <div className="rounded-xl bg-white/20 p-3">
          <Calendar className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-bold">ประวัติการรับเข้า</h3>
          <p className="text-sm text-blue-100">
            ดูย้อนหลังตามวัน + ดาวน์โหลดรายงานเป็น PDF
          </p>
        </div>
      </div>

      {/* Date controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 shadow-sm dark:bg-gray-900">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftDate(-1)}
            className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="ก่อนหน้า"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          />
          <button
            onClick={() => shiftDate(1)}
            disabled={isFutureDate}
            className="rounded-lg p-2 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800"
            aria-label="ถัดไป"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <span className="ml-2 text-sm text-gray-600 dark:text-gray-300">
            {formatThaiDate(date)}
          </span>
        </div>

        <button
          onClick={onDownload}
          disabled={downloading || totalItems === 0}
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:from-orange-600 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileDown className="h-4 w-4" />
          )}
          ดาวน์โหลดรายงาน PDF
        </button>
      </div>

      {/* Summary chip */}
      {!loading && totalItems > 0 && (
        <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
          รวม <b>{totalItems}</b> รายการ จาก <b>{groups.length}</b> สาขา
          ({totalSessions} รอบรับ) · HQ: <b>{hqName}</b>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="rounded-lg bg-white p-8 text-center shadow dark:bg-gray-900">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : totalItems === 0 ? (
        <div className="rounded-xl bg-white p-12 text-center shadow-sm dark:bg-gray-900">
          <Inbox className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            ไม่มีรายการรับเข้าในวันที่เลือก
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div
              key={g.from_store_name}
              className="overflow-hidden rounded-xl bg-white shadow-md dark:bg-gray-900"
            >
              <div className="flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 dark:from-blue-900/20 dark:to-indigo-900/20">
                <div>
                  <h4 className="text-sm font-bold text-blue-900 dark:text-blue-200">
                    {g.from_store_name}
                  </h4>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    {g.total_items} รายการ · {g.sessions.length} รอบรับ
                  </p>
                </div>
              </div>

              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {g.sessions.map((s, sIdx) => (
                  <div key={s.session_id} className="p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
                      <span>
                        รอบที่ {sIdx + 1} · รับโดย{' '}
                        <b>{s.received_by_name || '—'}</b> เวลา{' '}
                        {new Date(s.received_at).toLocaleTimeString('th-TH', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Asia/Bangkok',
                        })}{' '}
                        น.
                      </span>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        {s.items.length} รายการ
                      </span>
                    </div>

                    {s.received_photo_url && (
                      <a
                        href={s.received_photo_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mb-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400"
                      >
                        <ImageIcon className="h-3.5 w-3.5" /> รูปยืนยันรับ
                      </a>
                    )}

                    <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium">สินค้า</th>
                            <th className="px-2 py-1.5 text-left font-medium">ลูกค้า</th>
                            <th className="px-2 py-1.5 text-left font-medium">รหัสฝาก</th>
                            <th className="px-2 py-1.5 text-right font-medium">จำนวน</th>
                            <th className="px-2 py-1.5 text-center font-medium">สถานะ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {s.items.map((it) => (
                            <tr key={it.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                              <td className="px-2 py-1.5 text-gray-900 dark:text-gray-100">
                                {it.product_name || '—'}
                              </td>
                              <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300">
                                {it.customer_name || '—'}
                              </td>
                              <td className="px-2 py-1.5 font-mono text-gray-500 dark:text-gray-400">
                                {it.deposit_code || '—'}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-gray-900 dark:text-gray-100">
                                {it.quantity ?? '—'}
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                <span
                                  className={cn(
                                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                                    it.status === 'withdrawn'
                                      ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
                                  )}
                                >
                                  {it.status === 'withdrawn' ? 'จำหน่ายแล้ว' : 'อยู่ในคลัง'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
