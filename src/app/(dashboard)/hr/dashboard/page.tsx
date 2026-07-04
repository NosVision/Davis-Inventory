'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, Users, CheckCircle2, Palmtree, CircleSlash, Copy, RefreshCw } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

// §P5.3 manager/HR daily dashboard — "who's in today" for the caller's scope, with a one-tap
// copy-to-LINE summary (the field managers live in LINE). Self-contained locale strings.
interface Person { user_id: string; name: string }
interface Daily { business_date: string; headcount: number; checked_in: Person[]; on_leave: Person[]; not_in: Person[] }
interface StoreOpt { id: string; store_name: string | null; store_code: string | null }

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

function todayBangkok(): string {
  // en-CA gives YYYY-MM-DD; pin to Bangkok so "today" matches the business day.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

export default function HrDailyDashboardPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'แดชบอร์ดวันนี้', subtitle: 'ใครเข้างาน ใครลา ใครยังไม่มา — ในความดูแลของคุณ', date: 'วันที่', store: 'สาขา', allStores: 'ทุกสาขา', refresh: 'รีเฟรช', headcount: 'พนักงาน', checkedIn: 'เข้างานแล้ว', onLeave: 'ลา', notIn: 'ยังไม่เข้า', copyLine: 'คัดลอกสรุปไปไลน์', copied: 'คัดลอกแล้ว', copyFailed: 'คัดลอกไม่สำเร็จ', loadFailed: 'โหลดไม่สำเร็จ', none: '—', people: 'คน' }
    : { title: "Today's dashboard", subtitle: "Who's in, on leave, or not yet in — within your scope", date: 'Date', store: 'Store', allStores: 'All stores', refresh: 'Refresh', headcount: 'Headcount', checkedIn: 'Checked in', onLeave: 'On leave', notIn: 'Not in', copyLine: 'Copy summary for LINE', copied: 'Copied', copyFailed: 'Copy failed', loadFailed: 'Load failed', none: '—', people: '' };

  const [date, setDate] = useState(() => todayBangkok());
  const [storeId, setStoreId] = useState('');
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [data, setData] = useState<Daily | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/manageable-stores');
        setStores(((await res.json()).data ?? []) as StoreOpt[]);
      } catch { /* store filter is optional */ }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ business_date: date });
      if (storeId) qs.set('store_id', storeId);
      const res = await fetch(`/api/hr/dashboard/daily?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) { toast({ type: 'error', title: json?.error || L.loadFailed }); setData(null); return; }
      setData(json.data as Daily);
    } catch { toast({ type: 'error', title: L.loadFailed }); }
    finally { setLoading(false); }
  }, [date, storeId, L.loadFailed]);

  useEffect(() => { load(); }, [load]);

  const lineText = useMemo(() => {
    if (!data) return '';
    const storeName = storeId ? stores.find((s) => s.id === storeId)?.store_name ?? '' : (isTh ? 'ทุกสาขา' : 'All stores');
    const names = (list: Person[]) => (list.length ? list.map((p) => p.name).join(', ') : L.none);
    return [
      `📊 ${L.title} ${data.business_date}${storeName ? ` · ${storeName}` : ''}`,
      `👥 ${L.headcount} ${data.headcount} ${isTh ? L.people : ''}`.trim(),
      `✅ ${L.checkedIn} ${data.checked_in.length}: ${names(data.checked_in)}`,
      `🌴 ${L.onLeave} ${data.on_leave.length}: ${names(data.on_leave)}`,
      `⛔ ${L.notIn} ${data.not_in.length}: ${names(data.not_in)}`,
    ].join('\n');
  }, [data, storeId, stores, isTh, L]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lineText);
      toast({ type: 'success', title: L.copied });
    } catch { toast({ type: 'error', title: L.copyFailed }); }
  };

  const stats = data
    ? [
        { key: L.headcount, value: data.headcount, icon: Users, color: 'text-gray-600 dark:text-gray-300', bg: 'bg-gray-100 dark:bg-gray-700' },
        { key: L.checkedIn, value: data.checked_in.length, icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/30' },
        { key: L.onLeave, value: data.on_leave.length, icon: Palmtree, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/30' },
        { key: L.notIn, value: data.not_in.length, icon: CircleSlash, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/30' },
      ]
    : [];

  const PersonList = ({ title, list, tone }: { title: string; list: Person[]; tone: string }) => (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-center justify-between">
        <h2 className={cn('text-sm font-semibold', tone)}>{title}</h2>
        <span className="tabular-nums text-xs text-gray-400">{list.length}</span>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-gray-400">{L.none}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {list.map((p) => (
            <li key={p.user_id} className="rounded-full bg-gray-50 px-2.5 py-1 text-xs text-gray-700 dark:bg-gray-700/50 dark:text-gray-200">{p.name}</li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{L.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{L.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.date}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn('mt-1', inputCls)} />
          </label>
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.store}
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={cn('mt-1', inputCls)}>
              <option value="">{L.allStores}</option>
              {stores.map((s) => (<option key={s.id} value={s.id}>{s.store_name || s.store_code}</option>))}
            </select>
          </label>
          <Button variant="outline" type="button" onClick={load} icon={<RefreshCw className="h-4 w-4" />}>{L.refresh}</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.key} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <div className={cn('mb-2 flex h-9 w-9 items-center justify-center rounded-lg', s.bg)}>
                  <s.icon className={cn('h-5 w-5', s.color)} />
                </div>
                <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{s.value}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{s.key}</p>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button type="button" onClick={copy} icon={<Copy className="h-4 w-4" />}>{L.copyLine}</Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <PersonList title={L.checkedIn} list={data.checked_in} tone="text-emerald-600 dark:text-emerald-400" />
            <PersonList title={L.onLeave} list={data.on_leave} tone="text-amber-600 dark:text-amber-400" />
            <PersonList title={L.notIn} list={data.not_in} tone="text-red-600 dark:text-red-400" />
          </div>
        </>
      ) : null}
    </div>
  );
}
