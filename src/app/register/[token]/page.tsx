'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, Check, X, Search, UserPlus, ShieldQuestion } from 'lucide-react';
import { THAI_BANK_OPTIONS } from '@/lib/hr/bank-transfer';

interface Ctx {
  company_id: string | null;
  company_name: string | null;
  companies: { id: string; name: string }[];
  positions: { id: string; name: string }[];
}
interface Identity {
  id: string;
  full_name_th: string | null;
  full_name_en: string | null;
  position_text: string | null;
  company_id: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  status: string;
  store?: { store_name: string | null } | null;
}

const input =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
const label = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

export default function HrRegisterPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [invalid, setInvalid] = useState(false);

  const [username, setUsername] = useState('');
  const [uStatus, setUStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');

  // "username taken → verify & link to the existing account" sub-flow.
  const [loginPassword, setLoginPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<{ display_name: string; existing_bank_account_no: string | null; has_employee: boolean } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [wasLinked, setWasLinked] = useState(false);

  const [mode, setMode] = useState<'search' | 'manual'>('search');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Identity[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Identity | null>(null);

  const [fullName, setFullName] = useState('');
  const [bankNo, setBankNo] = useState('');
  const [bankName, setBankName] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [positionId, setPositionId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Set when the picked name is already claimed (HR reviewing) or linked (HR accepted) — blocks re-registration.
  const [alreadyRegistered, setAlreadyRegistered] = useState<{ status: string } | null>(null);

  // Load link context (companies + positions), or mark the link invalid.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/auth/hr-register?token=${encodeURIComponent(token)}`);
        if (!res.ok) { setInvalid(true); return; }
        const j = await res.json();
        setCtx(j.data as Ctx);
        if (j.data?.company_id) setCompanyId(j.data.company_id);
      } catch {
        setInvalid(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // Debounced username availability.
  const uTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (uTimer.current) clearTimeout(uTimer.current);
    setVerified(null); setVerifyError(null); setLoginPassword('');
    const u = username.trim().toLowerCase();
    if (!u) { setUStatus('idle'); return; }
    if (u.length < 3 || !/^[a-z0-9_]+$/.test(u)) { setUStatus('invalid'); return; }
    setUStatus('checking');
    uTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/hr-register?token=${encodeURIComponent(token)}&action=check-username&username=${encodeURIComponent(u)}`);
        const j = await res.json();
        setUStatus(j.data?.available ? 'ok' : 'taken');
      } catch {
        setUStatus('idle');
      }
    }, 400);
    return () => { if (uTimer.current) clearTimeout(uTimer.current); };
  }, [username, token]);

  // Debounced imported-identity search.
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (mode !== 'search') return;
    if (qTimer.current) clearTimeout(qTimer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    qTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/hr-register?token=${encodeURIComponent(token)}&action=identities&q=${encodeURIComponent(q.trim())}`);
        const j = await res.json();
        setResults((j.data ?? []) as Identity[]);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => { if (qTimer.current) clearTimeout(qTimer.current); };
  }, [q, mode, token]);

  // After success, send them to the login page automatically (they log in with their new/existing
  // credentials). The manual button stays as a fallback.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => router.push('/login'), 2500);
    return () => clearTimeout(timer);
  }, [done, router]);

  const pickIdentity = useCallback((it: Identity) => {
    // Already registered? Warn instead of letting them re-register.
    if (it.status && it.status !== 'unclaimed') {
      setAlreadyRegistered({ status: it.status });
      setResults([]);
      return;
    }
    setPicked(it);
    setFullName(it.full_name_th || it.full_name_en || '');
    setBankNo(it.bank_account_no || '');
    setBankName(it.bank_name || '');
    // Prefill company (unless the link is company-scoped) + match the position by its text.
    if (!ctx?.company_id && it.company_id) setCompanyId(it.company_id);
    if (it.position_text) {
      const want = it.position_text.trim().toLowerCase();
      const match = ctx?.positions.find((p) => p.name.trim().toLowerCase() === want);
      if (match) setPositionId(match.id);
    }
    setResults([]);
    setQ('');
  }, [ctx]);

  const canSubmit = useMemo(() => {
    return (
      uStatus === 'ok' &&
      password.length >= 6 &&
      password === password2 &&
      fullName.trim().length > 0 &&
      !submitting
    );
  }, [uStatus, password, password2, fullName, submitting]);

  const submit = async () => {
    setError(null);
    if (password !== password2) { setError('รหัสผ่านไม่ตรงกัน'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/hr-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          username: username.trim().toLowerCase(),
          password,
          full_name: fullName.trim(),
          bank_account_no: bankNo.trim() || undefined,
          bank_name: bankName.trim() || undefined,
          company_id: ctx?.company_id || companyId || undefined,
          position_id: positionId || undefined,
          pending_identity_id: picked?.id || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof j.error === 'string' ? j.error : 'สมัครไม่สำเร็จ'); return; }
      setDone(true);
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  };

  // Verify the existing account's login password, then reveal its bank account for a final confirm.
  const verify = async () => {
    setVerifyError(null);
    if (!loginPassword) return;
    setVerifying(true);
    try {
      const res = await fetch('/api/auth/hr-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'verify', username: username.trim().toLowerCase(), password: loginPassword }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.data?.ok) setVerified(j.data);
      else setVerifyError('รหัสผ่านไม่ถูกต้อง');
    } catch {
      setVerifyError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setVerifying(false);
    }
  };

  // Confirm: link this imported name/bank to the existing account (no new account).
  const linkExisting = async () => {
    setError(null);
    if (!fullName.trim()) { setError('กรุณาเลือกหรือกรอกชื่อ-นามสกุลก่อน'); return; }
    setLinking(true);
    try {
      const res = await fetch('/api/auth/hr-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          action: 'link',
          username: username.trim().toLowerCase(),
          password: loginPassword,
          full_name: fullName.trim(),
          bank_account_no: bankNo.trim() || undefined,
          bank_name: bankName.trim() || undefined,
          company_id: ctx?.company_id || companyId || undefined,
          position_id: positionId || undefined,
          pending_identity_id: picked?.id || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof j.error === 'string' ? j.error : 'ผูกบัญชีไม่สำเร็จ'); return; }
      setWasLinked(true);
      setDone(true);
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setLinking(false);
    }
  };

  // ── Render states ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (invalid || !ctx) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
        <div className="max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
          <ShieldQuestion className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
          <h1 className="mt-3 text-lg font-bold text-gray-900 dark:text-white">ลิงก์ไม่ถูกต้อง</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">ลิงก์สมัครนี้หมดอายุหรือถูกยกเลิกแล้ว กรุณาติดต่อ HR เพื่อขอลิงก์ใหม่</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
        <div className="max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
            <Check className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="mt-3 text-lg font-bold text-gray-900 dark:text-white">{wasLinked ? 'ผูกบัญชีสำเร็จ!' : 'สมัครสำเร็จ!'}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {wasLinked
              ? <>ผูกชื่อ-นามสกุลเข้ากับบัญชีเดิมเรียบร้อย เข้าสู่ระบบด้วยชื่อผู้ใช้ <b className="text-gray-800 dark:text-gray-200">{username.trim().toLowerCase()}</b> ได้เลย</>
              : <>บัญชีของคุณพร้อมใช้งานแล้ว เข้าสู่ระบบด้วยชื่อผู้ใช้ <b className="text-gray-800 dark:text-gray-200">{username.trim().toLowerCase()}</b> ได้เลย<br />รอ HR กำหนดสิทธิ์/ตำแหน่งให้อีกครั้ง</>}
          </p>
          <a href="/login" className="mt-5 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
            เข้าสู่ระบบ
          </a>
          <p className="mt-2 text-[11px] text-gray-400">กำลังพาไปหน้าเข้าสู่ระบบ…</p>
        </div>
      </div>
    );
  }

  if (alreadyRegistered) {
    const linked = alreadyRegistered.status === 'linked';
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
        <div className="max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <ShieldQuestion className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="mt-3 text-lg font-bold text-gray-900 dark:text-white">คุณลงทะเบียนไปแล้ว</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {linked
              ? 'ชื่อนี้ HR ยืนยัน/ผูกบัญชีไว้แล้ว — ไม่ต้องสมัครซ้ำ เข้าสู่ระบบด้วยบัญชีเดิมได้เลย'
              : 'ชื่อนี้ลงทะเบียนแล้ว อยู่ระหว่าง HR ตรวจสอบ — ไม่ต้องสมัครซ้ำ กรุณารอ HR ยืนยัน หรือติดต่อ HR'}
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <a href="/login" className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">เข้าสู่ระบบ</a>
            <button
              type="button"
              onClick={() => { setAlreadyRegistered(null); setQ(''); }}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              ค้นหาชื่ออื่น
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <div className="mx-auto max-w-md space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900/30">
            <UserPlus className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h1 className="mt-2 text-xl font-bold text-gray-900 dark:text-white">สมัครพนักงาน</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {ctx.company_name ? ctx.company_name : 'กรอกข้อมูลเพื่อสร้างบัญชีเข้าใช้งาน'}
          </p>
        </div>

        {/* Username */}
        <div>
          <label className={label}>ชื่อผู้ใช้ (สำหรับเข้าสู่ระบบ)</label>
          <div className="relative">
            <input
              className={input}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="เช่น somchai.k"
              autoCapitalize="none"
              autoComplete="off"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              {uStatus === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
              {uStatus === 'ok' && <Check className="h-4 w-4 text-emerald-500" />}
              {(uStatus === 'taken' || uStatus === 'invalid') && <X className="h-4 w-4 text-red-500" />}
            </span>
          </div>
          {uStatus === 'taken' && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">ชื่อผู้ใช้นี้มีอยู่แล้ว — ถ้าเป็นบัญชีของคุณ ยืนยันด้านล่างเพื่อผูกบัญชีเดิม</p>}
          {uStatus === 'invalid' && <p className="mt-1 text-xs text-red-500">ใช้ a-z, 0-9, _ อย่างน้อย 3 ตัว</p>}
        </div>

        {uStatus === 'taken' ? (
          /* Existing account → verify with the login password, then confirm linking. */
          <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-900/10">
            {!verified ? (
              <>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  มีบัญชีชื่อ <b>{username.trim().toLowerCase()}</b> อยู่แล้ว — ถ้าเป็นบัญชีของคุณ กรอกรหัสผ่าน (รหัสเข้าใช้งาน) เพื่อยืนยันตัวตน
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    className={input}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="รหัสผ่านเข้าใช้งาน"
                    autoComplete="current-password"
                    onKeyDown={(e) => { if (e.key === 'Enter') verify(); }}
                  />
                  <button type="button" onClick={verify} disabled={!loginPassword || verifying} className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
                    {verifying ? '…' : 'ยืนยันตัวตน'}
                  </button>
                </div>
                {verifyError && <p className="text-xs text-red-500">{verifyError}</p>}
              </>
            ) : (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  <Check className="h-4 w-4" /> ยืนยันตัวตนแล้ว — {verified.display_name}
                </p>
                {(verified.existing_bank_account_no || bankNo) && (
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    เลขที่บัญชี: <b className="tabular-nums">{verified.existing_bank_account_no || bankNo}</b>
                  </p>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  ยืนยันผูกชื่อ <b className="text-gray-800 dark:text-gray-200">{fullName.trim() || '(เลือก/กรอกชื่อด้านล่างก่อน)'}</b> กับบัญชีนี้ แทนการสมัครใหม่
                </p>
              </div>
            )}
          </div>
        ) : (
          /* New account → set a password. */
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>รหัสผ่าน</label>
              <input type="password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6 ตัวขึ้นไป" autoComplete="new-password" />
            </div>
            <div>
              <label className={label}>ยืนยันรหัสผ่าน</label>
              <input type="password" className={input} value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
              {password2 && password !== password2 && <p className="mt-1 text-xs text-red-500">รหัสผ่านไม่ตรงกัน</p>}
            </div>
          </div>
        )}

        {/* Identity: search imported OR manual */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className={`${label} mb-0`}>ข้อมูลพนักงาน</label>
            <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-xs dark:bg-gray-700">
              <button type="button" onClick={() => setMode('search')} className={`rounded-md px-2 py-1 font-medium ${mode === 'search' ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500'}`}>ค้นหาชื่อ</button>
              <button type="button" onClick={() => { setMode('manual'); setPicked(null); }} className={`rounded-md px-2 py-1 font-medium ${mode === 'manual' ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500'}`}>กรอกเอง</button>
            </div>
          </div>

          {mode === 'search' && !picked && (
            <div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input className={`${input} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์ชื่อจริง หรือเลขบัญชี" />
              </div>
              {searching && <p className="mt-1 text-xs text-gray-400">กำลังค้นหา…</p>}
              {results.length > 0 && (
                <ul className="mt-1 max-h-52 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                  {results.map((it) => (
                    <li key={it.id}>
                      <button type="button" onClick={() => pickIdentity(it)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">{it.full_name_th || it.full_name_en}</span>
                          <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                            {[it.position_text, it.store?.store_name, it.bank_account_no ? `****${it.bank_account_no.slice(-4)}` : null].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        {it.status !== 'unclaimed' && (
                          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${it.status === 'linked' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                            {it.status === 'linked' ? 'ลงทะเบียนแล้ว' : 'รอตรวจสอบ'}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {q.trim().length >= 2 && !searching && results.length === 0 && (
                <p className="mt-1 text-xs text-gray-400">ไม่พบชื่อ — กด &quot;กรอกเอง&quot; เพื่อระบุข้อมูลเอง</p>
              )}
            </div>
          )}

          {(mode === 'manual' || picked) && (
            <div className="space-y-3">
              {picked && (
                <div className="flex items-center justify-between rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300">
                  <span>เลือกจากข้อมูลนำเข้าแล้ว</span>
                  <button type="button" onClick={() => { setPicked(null); setMode('search'); setFullName(''); setBankNo(''); setBankName(''); }} className="font-medium underline">เปลี่ยน</button>
                </div>
              )}
              <div>
                <label className={label}>ชื่อ-นามสกุล</label>
                <input className={input} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="เช่น นายสมชาย ใจดี" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={label}>เลขบัญชีธนาคาร</label>
                  <input className={input} value={bankNo} onChange={(e) => setBankNo(e.target.value)} inputMode="numeric" />
                </div>
                <div>
                  <label className={label}>ธนาคาร</label>
                  <select className={input} value={bankName} onChange={(e) => setBankName(e.target.value)}>
                    <option value="">ไม่มีบัญชี (รับเงินสด)</option>
                    {THAI_BANK_OPTIONS.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.nameTh} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Company (only if the link isn't company-scoped) + Position */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {!ctx.company_id && (
            <div>
              <label className={label}>บริษัท</label>
              <select className={input} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">— เลือก —</option>
                {ctx.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={label}>ตำแหน่ง</label>
            <select className={input} value={positionId} onChange={(e) => setPositionId(e.target.value)}>
              <option value="">— เลือก —</option>
              {ctx.positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}

        {uStatus === 'taken' ? (
          <>
            <button
              type="button"
              onClick={linkExisting}
              disabled={!verified || !fullName.trim() || linking}
              className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {linking ? 'กำลังผูกบัญชี…' : 'ยืนยันผูกกับบัญชีเดิม'}
            </button>
            <p className="text-center text-[11px] text-gray-400">ผูกชื่อ-นามสกุลกับบัญชีที่มีอยู่ แทนการสมัครใหม่</p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'กำลังสมัคร…' : 'สมัครและสร้างบัญชี'}
            </button>
            <p className="text-center text-[11px] text-gray-400">สมัครแล้วจะได้สิทธิ์ &quot;ยังไม่ระบุ&quot; รอ HR กำหนดตำแหน่ง/สิทธิ์ให้อีกครั้ง</p>
          </>
        )}
      </div>
    </div>
  );
}
