'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { UserCheck, Search } from 'lucide-react';
import { Modal, ModalFooter, Button, toast } from '@/components/ui';

// Identity-claim prompt (owner flow 2026-07-05): an app user who is NOT yet linked to an
// hr_employees record (and has no claim awaiting HR) is asked to pick their REAL full name from
// the imported payroll roster. [ยืนยันทันที] opens a type-ahead over the unclaimed names;
// [เอาไว้ทีหลัง] snoozes until the next day. Saving notifies HR to verify. Self-contained locale.
interface Option { id: string; full_name_th: string; store_name: string | null }

const SNOOZE_KEY = 'hr-identity-snooze'; // Bangkok date string — re-prompt on the next day
const DONE_KEY = 'hr-identity-done'; // '1' once linked/claimed — skip the status fetch entirely

function bkkToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

export function IdentityClaimModal({ role }: { role: string }) {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'กรุณาระบุชื่อจริงในระบบของคุณ', body: 'HR กำลังเชื่อมบัญชีผู้ใช้กับประวัติพนักงาน กรุณาเลือกชื่อ-นามสกุลจริงของคุณเพื่อยืนยันตัวตน', confirmNow: 'ยืนยันทันที', later: 'เอาไว้ทีหลัง', searchPh: 'พิมพ์ชื่อจริงของคุณ…', pick: 'เลือกชื่อของคุณ', submit: 'ยืนยัน', sent: 'ส่งให้ HR ตรวจสอบแล้ว', sentBody: 'เมื่อ HR อนุมัติ บัญชีของคุณจะถูกผูกกับประวัติพนักงานอัตโนมัติ', failed: 'ส่งไม่สำเร็จ ลองใหม่อีกครั้ง', taken: 'ชื่อนี้ถูกยืนยันไปแล้ว — เลือกใหม่', noResult: 'ไม่พบชื่อ ลองพิมพ์เพิ่ม หรือติดต่อ HR' }
    : { title: 'Please identify your real name', body: 'HR is linking app accounts to employee records. Pick your real full name to confirm your identity.', confirmNow: 'Confirm now', later: 'Later', searchPh: 'Type your real name…', pick: 'Select your name', submit: 'Confirm', sent: 'Sent to HR for review', sentBody: 'Once HR approves, your account is linked to your employee record automatically.', failed: 'Failed — try again', taken: 'That name was just claimed — pick again', noResult: 'No match — type more, or contact HR' };

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'ask' | 'pick'>('ask');
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [chosen, setChosen] = useState<Option | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Roles that are never venue employees (owner is excluded from claiming anyway; customer has
  // no dashboard). Everyone else may be an employee, so they get the prompt.
  const eligible = role !== 'owner' && role !== 'customer';

  useEffect(() => {
    if (!eligible) return;
    try {
      if (localStorage.getItem(DONE_KEY) === '1') return;
      if (localStorage.getItem(SNOOZE_KEY) === bkkToday()) return;
    } catch { /* storage unavailable → just check the API */ }
    (async () => {
      try {
        const res = await fetch('/api/hr/ess/identity');
        if (!res.ok) return;
        const d = (await res.json())?.data;
        if (d?.linked || d?.claim) {
          try { localStorage.setItem(DONE_KEY, '1'); } catch { /* ignore */ }
          return;
        }
        setOpen(true);
      } catch { /* silent — never block the app over this prompt */ }
    })();
  }, [eligible]);

  // Manual entry point (e.g. the "ผูกชื่อ" button on /me/profile) — force-open regardless of
  // snooze; re-check the API so an already-linked user never gets a dead prompt.
  useEffect(() => {
    if (!eligible) return;
    const onOpen = async () => {
      try {
        const res = await fetch('/api/hr/ess/identity');
        const d = (await res.json())?.data;
        if (!res.ok || d?.linked || d?.claim) return;
        try { localStorage.removeItem(DONE_KEY); } catch { /* ignore */ }
        setStep('ask');
        setOpen(true);
      } catch { /* ignore */ }
    };
    window.addEventListener('hr-identity-open', onOpen);
    return () => window.removeEventListener('hr-identity-open', onOpen);
  }, [eligible]);

  useEffect(() => {
    if (step !== 'pick') return;
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) { setOptions([]); return; }
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/hr/ess/identity/options?q=${encodeURIComponent(q.trim())}`);
        const d = await res.json().catch(() => ({}));
        if (res.ok) setOptions((d.data ?? []) as Option[]);
      } catch { /* keep previous options */ }
    }, 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, step]);

  const snooze = () => {
    try { localStorage.setItem(SNOOZE_KEY, bkkToday()); } catch { /* ignore */ }
    setOpen(false);
  };

  const submit = async () => {
    if (!chosen) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/hr/ess/identity/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity_id: chosen.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && String(json?.error ?? '').includes('pick again')) {
        toast({ type: 'warning', title: L.taken });
        setChosen(null);
        setOptions([]);
        setQ('');
        return;
      }
      if (!res.ok) throw new Error(json?.error);
      try { localStorage.setItem(DONE_KEY, '1'); } catch { /* ignore */ }
      toast({ type: 'success', title: L.sent, message: L.sentBody });
      setOpen(false);
    } catch {
      toast({ type: 'error', title: L.failed });
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  return (
    <Modal isOpen onClose={snooze} title={L.title} size="md" showClose={false}>
      {step === 'ask' ? (
        <>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/30">
              <UserCheck className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">{L.body}</p>
          </div>
          <ModalFooter>
            <Button variant="ghost" onClick={snooze}>{L.later}</Button>
            <Button onClick={() => setStep('pick')}>{L.confirmNow}</Button>
          </ModalFooter>
        </>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => { setQ(e.target.value); setChosen(null); }}
              placeholder={L.searchPh}
              className="control w-full pl-9"
              aria-label={L.searchPh}
            />
          </div>
          {q.trim().length >= 2 && (
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {options.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400">{L.noResult}</p>
              ) : (
                options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setChosen(o)}
                    aria-pressed={chosen?.id === o.id}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      chosen?.id === o.id
                        ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-900/20'
                        : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <span className="font-medium text-gray-900 dark:text-white">{o.full_name_th}</span>
                    {o.store_name && <span className="text-xs text-gray-400">{o.store_name}</span>}
                  </button>
                ))
              )}
            </div>
          )}
          <ModalFooter>
            <Button variant="ghost" onClick={snooze}>{L.later}</Button>
            <Button onClick={submit} disabled={!chosen || submitting} isLoading={submitting}>{L.submit}</Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
