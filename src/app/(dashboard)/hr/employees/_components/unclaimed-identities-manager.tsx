'use client';

/**
 * "รอยืนยันตัวตน" — the imported sheet names that still have no person behind them.
 *
 * The problem this solves (owner ask 2026-08-07): HR imported everyone from the payroll sheet
 * into hr_pending_identities, but a name only becomes a real employee when someone claims it and
 * HR approves. 122 names were still sitting unclaimed because the employees never knew they were
 * there — and until a name is linked, that person cannot appear in a payrun at all.
 *
 * So HR gets the other half of the flow: see who is waiting, search the user accounts that have
 * no employee record yet, and link them directly. The link runs the exact same onboarding as the
 * employee-initiated claim (lib/hr/identity-link).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, UserPlus, Search, Inbox, AlertTriangle, Link2 } from 'lucide-react';
import { Button, Modal, ModalFooter, Select, StatusBadge, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

interface Identity {
  id: string;
  full_name_th: string;
  full_name_en: string | null;
  position_text: string | null;
  employee_code: string | null;
  rate_satang: number | null;
  pay_type: string | null;
  start_date: string | null;
  sheet_ref: string | null;
  company: { id: string; name: string | null } | null;
  store: { id: string; store_name: string | null } | null;
}

interface Candidate {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
}

function bahtFromSatang(satang: number | null): string {
  if (!satang) return '—';
  return (satang / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
}

export function UnclaimedIdentitiesManager() {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('all');

  // link modal
  const [linkTarget, setLinkTarget] = useState<Identity | null>(null);
  const [accountSearch, setAccountSearch] = useState('');
  const [pickedId, setPickedId] = useState('');
  const [note, setNote] = useState('');
  const [linking, setLinking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/identity-claims/unclaimed');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error);
      setIdentities((json.data?.identities ?? []) as Identity[]);
      setCandidates((json.data?.candidates ?? []) as Candidate[]);
    } catch {
      setIdentities([]);
      setCandidates([]);
      toast({ type: 'error', title: 'โหลดรายชื่อไม่สำเร็จ' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const companyOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of identities) if (i.company?.id) map.set(i.company.id, i.company.name ?? '—');
    return [{ value: 'all', label: 'ทุกบริษัท' }, ...[...map].map(([value, label]) => ({ value, label }))];
  }, [identities]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return identities.filter((i) => {
      if (companyFilter !== 'all' && i.company?.id !== companyFilter) return false;
      if (!q) return true;
      return (
        i.full_name_th.toLowerCase().includes(q) ||
        (i.full_name_en ?? '').toLowerCase().includes(q) ||
        (i.position_text ?? '').toLowerCase().includes(q) ||
        (i.employee_code ?? '').toLowerCase().includes(q)
      );
    });
  }, [identities, search, companyFilter]);

  // Candidate accounts, ranked so the likely match floats up: an account whose nickname contains
  // part of the sheet name is almost always the right person.
  const rankedCandidates = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    const filtered = q
      ? candidates.filter(
          (c) => c.username.toLowerCase().includes(q) || (c.display_name ?? '').toLowerCase().includes(q)
        )
      : candidates;
    if (!linkTarget) return filtered.slice(0, 50);

    // Compare on name words, ignoring the นาย/นาง/นางสาว prefix the sheet always carries.
    const words = linkTarget.full_name_th
      .replace(/^(นาย|นางสาว|นาง)\s*/, '')
      .split(/\s+/)
      .filter((w) => w.length >= 2)
      .map((w) => w.toLowerCase());
    const score = (c: Candidate) => {
      const hay = `${c.display_name ?? ''} ${c.username}`.toLowerCase();
      return words.reduce((s, w) => (hay.includes(w) ? s + 1 : s), 0);
    };
    return [...filtered].sort((a, b) => score(b) - score(a)).slice(0, 50);
  }, [candidates, accountSearch, linkTarget]);

  const openLink = (i: Identity) => {
    setLinkTarget(i);
    setAccountSearch('');
    setPickedId('');
    setNote('');
  };

  const submitLink = async () => {
    if (!linkTarget || !pickedId) return;
    setLinking(true);
    try {
      const res = await fetch(`/api/hr/identity-claims/${linkTarget.id}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: pickedId, note: note.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'ผูกไม่สำเร็จ');

      const warnings = (json.data?.warnings ?? []) as string[];
      toast({
        type: warnings.length ? 'error' : 'success',
        title: `ผูก "${linkTarget.full_name_th}" เรียบร้อยแล้ว`,
        message: warnings.length ? warnings.join(' · ') : 'พนักงานคนนี้เข้าระบบเงินเดือนได้แล้ว',
      });
      setLinkTarget(null);
      await load();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : 'ผูกไม่สำเร็จ' });
    } finally {
      setLinking(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Why this tab exists, in one line HR can act on */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/15 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          รายชื่อเหล่านี้นำเข้ามาจากไฟล์เงินเดือนแล้ว แต่<span className="font-semibold">ยังไม่ได้ผูกกับบัญชีผู้ใช้</span>{' '}
          จึงยังไม่มีทะเบียนพนักงาน และ<span className="font-semibold">จะไม่เข้างวดเงินเดือน</span> — ผูกกับบัญชีให้เรียบร้อยหรือรอให้พนักงานยืนยันตัวตนเอง
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[15rem] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ / ตำแหน่ง / รหัสพนักงาน…"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </div>
        <Select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          options={companyOptions}
          className="min-w-[12rem]"
        />
        <span className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          {rows.length} รายชื่อ · บัญชีที่ผูกได้ {candidates.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 py-16 text-center text-sm text-gray-400 dark:border-gray-700">
          <Inbox className="h-8 w-8" />
          {identities.length === 0 ? 'ทุกคนยืนยันตัวตนครบแล้ว 🎉' : 'ไม่พบรายชื่อที่ค้นหา'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">ชื่อ-นามสกุล (จากชีท)</th>
                <th className="px-3 py-2 text-left font-medium">ตำแหน่ง</th>
                <th className="px-3 py-2 text-left font-medium">บริษัท / สาขา</th>
                <th className="px-3 py-2 text-right font-medium">ค่าจ้าง</th>
                <th className="px-3 py-2 text-left font-medium">เริ่มงาน</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {rows.map((i) => (
                <tr key={i.id} className="text-gray-700 dark:text-gray-200">
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900 dark:text-white">{i.full_name_th}</p>
                    <p className="text-[11px] text-gray-400">
                      {[i.employee_code, i.sheet_ref].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-xs">{i.position_text || '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    <p>{i.company?.name || '—'}</p>
                    {i.store?.store_name && <p className="text-[11px] text-gray-400">{i.store.store_name}</p>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">{bahtFromSatang(i.rate_satang)}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{i.start_date || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => openLink(i)}>
                      <Link2 className="h-3.5 w-3.5" />
                      ผูกบัญชี
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={!!linkTarget}
        onClose={() => setLinkTarget(null)}
        title="ผูกรายชื่อกับบัญชีผู้ใช้"
        description={
          linkTarget
            ? `${linkTarget.full_name_th}${linkTarget.position_text ? ` · ${linkTarget.position_text}` : ''}`
            : undefined
        }
        size="md"
      >
        <div className="space-y-3">
          <div className="rounded-lg bg-indigo-50/70 px-3 py-2 text-xs text-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300">
            เมื่อผูกแล้ว ระบบจะสร้างทะเบียนพนักงานให้อัตโนมัติ พร้อมดึงค่าจ้าง วันเริ่มงาน ประกันสังคม ภาษี
            สลิปย้อนหลัง และวันลาคงเหลือจากชีทมาให้ — เหมือนกับตอนที่พนักงานยืนยันตัวตนเอง
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              placeholder="ค้นหาชื่อผู้ใช้หรือชื่อเล่น…"
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-1 dark:border-gray-700">
            {rankedCandidates.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400">
                ไม่พบบัญชีที่ยังไม่ผูก — ทุกบัญชีมีทะเบียนพนักงานแล้ว หรือต้องสร้างบัญชีใหม่ก่อน
              </p>
            ) : (
              rankedCandidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setPickedId(c.id)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    pickedId === c.id
                      ? 'bg-indigo-50 ring-1 ring-indigo-400 dark:bg-indigo-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  )}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600 dark:bg-gray-600 dark:text-gray-200">
                    {(c.display_name || c.username).charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-gray-900 dark:text-white">
                      {c.display_name || c.username}
                    </span>
                    <span className="block truncate text-[11px] text-gray-400">@{c.username}</span>
                  </span>
                  <StatusBadge tone="neutral" label={c.role} />
                </button>
              ))
            )}
          </div>

          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            หมายเหตุ (ไม่บังคับ)
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น ยืนยันกับหัวหน้าสาขาแล้ว"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </label>
        </div>

        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setLinkTarget(null)} disabled={linking}>
            ยกเลิก
          </Button>
          <Button size="sm" onClick={submitLink} disabled={!pickedId || linking}>
            {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            ผูกและสร้างทะเบียนพนักงาน
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
