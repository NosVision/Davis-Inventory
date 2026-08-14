'use client';

/**
 * "หัวหน้าสาขา" — who runs which venue.
 *
 * Writes hr_manager_scopes, which is what actually decides whether someone can approve their
 * team's leave and build their venue's roster (owner change 2026-08-07). Nothing in the app could
 * set it before, so production had one row and it belonged to a test account — meaning no real
 * manager could approve anything. This is that missing control.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, UserPlus, X, Store, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button, Modal, ModalFooter, StatusBadge, useConfirm, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { EmployeeName } from '@/components/hr/employee-name';
import { ROLE_LABELS } from '@/types/roles';

interface Manager {
  scope_id: string;
  user_id: string;
  username: string | null;
  role: string | null;
  name: string;
  nickname: string | null;
  /** The roster half: shifts, days off, day-off swaps. */
  can_schedule: boolean;
  /** The approval half: leave, OT, attendance corrections, claims, geofence. */
  can_approve: boolean;
}
interface StoreRow {
  id: string;
  store_code: string | null;
  store_name: string | null;
  managers: Manager[];
}
interface Candidate {
  id: string;
  username: string;
  role: string;
  name: string;
  nickname: string | null;
}

export function ManagerScopesManager() {
  const { confirm, dialog } = useConfirm();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [addFor, setAddFor] = useState<StoreRow | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  // Which authority the next grant carries. Two named kinds rather than raw checkboxes, because
  // HR is picking a job, not composing permissions (client request 2026-08-14).
  const [grantKind, setGrantKind] = useState<'manager' | 'captain'>('manager');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/manager-scopes');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error);
      setStores((json.data?.stores ?? []) as StoreRow[]);
      setCandidates((json.data?.candidates ?? []) as Candidate[]);
    } catch {
      toast({ type: 'error', title: 'โหลดข้อมูลหัวหน้าสาขาไม่สำเร็จ' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pickable = useMemo(() => {
    const q = search.trim().toLowerCase();
    const already = new Set((addFor?.managers ?? []).map((m) => m.user_id));
    return candidates
      .filter((c) => !already.has(c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.username.toLowerCase().includes(q))
      .slice(0, 60);
  }, [candidates, search, addFor]);

  const assign = async (userId: string) => {
    if (!addFor) return;
    setSaving(true);
    try {
      const res = await fetch('/api/hr/manager-scopes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          store_id: addFor.id,
          can_schedule: true,
          can_approve: grantKind === 'manager',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'เพิ่มไม่สำเร็จ');
      toast({
        type: 'success',
        title: `ตั้งเป็น${grantKind === 'manager' ? 'หัวหน้าสาขา' : 'กัปตัน'} ${addFor.store_name} แล้ว`,
      });
      setAddFor(null);
      await load();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : 'เพิ่มไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (store: StoreRow, m: Manager) => {
    const ok = await confirm({
      title: `ถอด ${m.name} ออกจากหัวหน้าสาขา ${store.store_name}?`,
      message: 'จะอนุมัติใบลาและจัดตารางของสาขานี้ไม่ได้อีก',
      tone: 'danger',
      confirmLabel: 'ถอดสิทธิ์',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/hr/manager-scopes?id=${m.scope_id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast({ type: 'success', title: 'ถอดสิทธิ์แล้ว' });
      await load();
    } catch {
      toast({ type: 'error', title: 'ถอดสิทธิ์ไม่สำเร็จ' });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // "Has someone" is not the question — "has someone who can approve" is. A store with a captain
  // and no manager still sends every leave request to HR, and a warning that counted heads would
  // call that store covered.
  const storesWithout = stores.filter((s) => !s.managers.some((m) => m.can_approve));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2.5 text-xs text-indigo-800 dark:border-indigo-800/60 dark:bg-indigo-900/15 dark:text-indigo-300">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          หัวหน้าสาขาจะ <span className="font-semibold">อนุมัติใบลาของพนักงานในสาขานั้น</span> และ{' '}
          <span className="font-semibold">จัดตารางงานของสาขานั้น</span> ได้ —
          ส่วนพนักงานที่ยังไม่มีสังกัดหรือเป็นพนักงานระดับบริษัท จะยังส่งตรงมาที่ HR เหมือนเดิม
        </p>
      </div>

      {storesWithout.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/15 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-semibold">{storesWithout.length} สาขายังไม่มีคนอนุมัติ</span> —
            ใบลา/OT/เบิกเงินของสาขาเหล่านี้จะตกมาที่ HR ทั้งหมด: {storesWithout.map((s) => s.store_name).join(' · ')}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {stores.map((s) => (
          <div
            key={s.id}
            className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Store className="h-4 w-4 shrink-0 text-gray-400" />
                <p className="truncate font-medium text-gray-900 dark:text-white">{s.store_name}</p>
                {s.managers.length === 0 ? (
                  <StatusBadge tone="warn" label="ยังไม่มีผู้ดูแล" />
                ) : !s.managers.some((m) => m.can_approve) ? (
                  <StatusBadge tone="warn" label="มีแต่กัปตัน — ไม่มีคนอนุมัติ" />
                ) : null}
              </div>
              <Button size="sm" variant="outline" onClick={() => { setAddFor(s); setSearch(''); setGrantKind('manager'); }}>
                <UserPlus className="h-3.5 w-3.5" />
                เพิ่ม
              </Button>
            </div>

            {s.managers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.managers.map((m) => (
                  <span
                    key={m.scope_id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                  >
                    <EmployeeName name={m.name} nickname={m.nickname} />
                    {/* What they may actually do here, which no longer follows from their job
                        title: a captain runs the roster and approves nothing. */}
                    <span className="text-indigo-400">
                      {m.can_approve ? 'หัวหน้าสาขา' : 'กัปตัน — ตารางงาน'}
                    </span>
                    <button
                      type="button"
                      onClick={() => revoke(s, m)}
                      className="cursor-pointer rounded-full p-0.5 text-indigo-400 transition-colors hover:bg-indigo-200/60 hover:text-indigo-700 dark:hover:bg-indigo-800/60"
                      title="ถอดสิทธิ์"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal
        isOpen={!!addFor}
        onClose={() => setAddFor(null)}
        title="เพิ่มผู้ดูแลสาขา"
        description={addFor?.store_name ?? undefined}
        size="md"
      >
        <div className="space-y-3">
          {/* Pick the job before the person: the same account can be either, and the difference
              is whether leave lands on their desk. */}
          <div className="grid grid-cols-2 gap-2">
            {([
              { k: 'manager', label: 'หัวหน้าสาขา', hint: 'จัดตารางงาน + อนุมัติใบลา/OT/เบิกเงิน' },
              { k: 'captain', label: 'กัปตัน', hint: 'จัดตารางงาน + สลับวันหยุด เท่านั้น' },
            ] as const).map((o) => (
              <button
                key={o.k}
                type="button"
                onClick={() => setGrantKind(o.k)}
                className={`rounded-xl border p-2.5 text-left transition-colors ${
                  grantKind === o.k
                    ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-900/25'
                    : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                }`}
              >
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{o.label}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{o.hint}</p>
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อหรือชื่อผู้ใช้…"
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-1 dark:border-gray-700">
            {pickable.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400">ไม่พบบัญชีที่ค้นหา</p>
            ) : (
              pickable.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={saving}
                  onClick={() => assign(c.id)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    'hover:bg-indigo-50 disabled:opacity-50 dark:hover:bg-indigo-900/20'
                  )}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600 dark:bg-gray-600 dark:text-gray-200">
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <EmployeeName
                      name={c.name}
                      nickname={c.nickname}
                      className="block truncate font-medium text-gray-900 dark:text-white"
                    />
                    <span className="block truncate text-[11px] text-gray-400">@{c.username}</span>
                  </span>
                  <StatusBadge tone="neutral" label={ROLE_LABELS[c.role as keyof typeof ROLE_LABELS] || c.role} />
                </button>
              ))
            )}
          </div>
        </div>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setAddFor(null)} disabled={saving}>
            ปิด
          </Button>
        </ModalFooter>
      </Modal>
      {dialog}
    </div>
  );
}
