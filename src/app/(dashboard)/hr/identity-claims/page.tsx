'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, UserCheck, Users, Link2, CircleDashed } from 'lucide-react';
import {
  Button,
  PageHeader,
  KpiRow,
  StatTile,
  DataList,
  DataCard,
  StatusBadge,
  SectionHeading,
  usePromptDialog,
  ViewToggle,
  useViewMode,
  toast,
} from '@/components/ui';

// HR review queue for employee identity claims (owner flow 2026-07-05): who in the app says they
// are which payroll-sheet name. Approve → hr_employees is created on the claimant's existing
// account; reject (with a note) returns the name to the pool. Also shows import coverage
// (linked / awaiting review / still unclaimed). Self-contained locale strings.
interface Claim {
  id: string;
  full_name_th: string;
  position_text: string | null;
  start_date: string | null;
  sheet_ref: string | null;
  claimed_at: string | null;
  company: { name: string } | null;
  store: { store_name: string } | null;
  claimant: { id: string; username: string | null; display_name: string | null } | null;
}
interface Unclaimed { id: string; full_name_th: string; store: { store_name: string } | null }

export default function HrIdentityClaimsPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'ยืนยันตัวตนพนักงาน', subtitle: 'ตรวจสอบว่าบัญชีผู้ใช้ไหนคือพนักงานคนไหน แล้วอนุมัติเพื่อผูกประวัติ', claimed: 'รอตรวจสอบ', unclaimed: 'ยังไม่ยืนยัน', linked: 'ผูกแล้ว', queue: 'คิวรอตรวจสอบ', empty: 'ไม่มีคำขอค้าง', unclaimedList: 'รายชื่อที่ยังไม่มีใครยืนยัน', approve: 'อนุมัติ', reject: 'ปฏิเสธ', rejectReason: 'เหตุผลที่ปฏิเสธ (แจ้งพนักงาน)', approved: 'ผูกบัญชีแล้ว', rejected: 'ปฏิเสธแล้ว — ชื่อกลับเข้ารายการ', failed: 'ทำรายการไม่สำเร็จ', claimsAs: 'ระบุว่าเป็น', sheetPos: 'ตำแหน่งในชีท', started: 'เริ่มงาน', account: 'บัญชี' }
    : { title: 'Employee identity claims', subtitle: 'Verify which app account is which employee, then approve to link', claimed: 'Awaiting review', unclaimed: 'Unclaimed', linked: 'Linked', queue: 'Review queue', empty: 'No pending claims', unclaimedList: 'Names not yet claimed', approve: 'Approve', reject: 'Reject', rejectReason: 'Rejection reason (shown to the employee)', approved: 'Account linked', rejected: 'Rejected — name returned to the pool', failed: 'Action failed', claimsAs: 'claims to be', sheetPos: 'Sheet position', started: 'Started', account: 'Account' };

  const { prompt, dialog } = usePromptDialog();
  const [view, setView] = useViewMode('hr-identity-claims');
  const [claims, setClaims] = useState<Claim[]>([]);
  const [unclaimed, setUnclaimed] = useState<Unclaimed[]>([]);
  const [counts, setCounts] = useState({ claimed: 0, unclaimed: 0, linked: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/identity-claims');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error);
      setClaims((json.data?.claims ?? []) as Claim[]);
      setUnclaimed((json.data?.unclaimed ?? []) as Unclaimed[]);
      setCounts(json.data?.counts ?? { claimed: 0, unclaimed: 0, linked: 0 });
    } catch {
      toast({ type: 'error', title: L.failed });
    } finally {
      setLoading(false);
    }
  }, [L.failed]);

  useEffect(() => { load(); }, [load]);

  const decide = useCallback(
    async (id: string, decision: 'approve' | 'reject') => {
      let note: string | null = null;
      if (decision === 'reject') {
        note = await prompt({ title: L.rejectReason, required: true });
        if (!note) return;
      }
      setBusy(id);
      try {
        const res = await fetch(`/api/hr/identity-claims/${id}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, note }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error);
        toast({ type: 'success', title: decision === 'approve' ? L.approved : L.rejected });
        await load();
      } catch (e) {
        toast({ type: 'error', title: L.failed, message: e instanceof Error ? e.message : undefined });
      } finally {
        setBusy(null);
      }
    },
    [prompt, load, L]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader title={L.title} subtitle={L.subtitle} actions={<ViewToggle value={view} onChange={setView} />} />

      <KpiRow cols={3}>
        <StatTile label={L.claimed} value={counts.claimed} icon={UserCheck} tone={counts.claimed > 0 ? 'warn' : 'default'} />
        <StatTile label={L.unclaimed} value={counts.unclaimed} icon={CircleDashed} />
        <StatTile label={L.linked} value={counts.linked} icon={Link2} tone="good" />
      </KpiRow>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          <SectionHeading title={L.queue} />
          {claims.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400 dark:border-gray-700">{L.empty}</p>
          ) : (
            <DataList compact={view === 'compact'}>
              {claims.map((c) => (
                <DataCard
                  key={c.id}
                  accent="warn"
                  title={
                    <>
                      {c.claimant?.display_name || c.claimant?.username || '—'}
                      <span className="mx-1.5 font-normal text-gray-400">{L.claimsAs}</span>
                      {c.full_name_th}
                    </>
                  }
                  subtitle={`${L.account}: ${c.claimant?.username ?? '—'} · ${c.store?.store_name ?? c.company?.name ?? ''}`}
                  status={<StatusBadge tone="warn" label={L.claimed} />}
                  actions={
                    <>
                      <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => decide(c.id, 'reject')}>{L.reject}</Button>
                      <Button size="sm" disabled={busy === c.id} isLoading={busy === c.id} onClick={() => decide(c.id, 'approve')}>{L.approve}</Button>
                    </>
                  }
                >
                  {c.position_text ? `${L.sheetPos}: ${c.position_text}` : ''}{c.start_date ? ` · ${L.started} ${c.start_date}` : ''}{c.sheet_ref ? ` · ${c.sheet_ref}` : ''}
                </DataCard>
              ))}
            </DataList>
          )}

          <SectionHeading title={`${L.unclaimedList} (${counts.unclaimed})`} extra={<Users className="h-4 w-4 text-gray-400" />} />
          <div className="flex flex-wrap gap-1.5">
            {unclaimed.map((u) => (
              <span key={u.id} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-700/60 dark:text-gray-300">
                {u.full_name_th}
                {u.store?.store_name ? <span className="ml-1 text-gray-400">· {u.store.store_name}</span> : null}
              </span>
            ))}
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}
