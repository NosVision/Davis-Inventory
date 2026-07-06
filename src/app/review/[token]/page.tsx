'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Download, Save, CheckCircle2, Building2, Lock } from 'lucide-react';

// หน้าสำหรับสำนักงานบัญชี (PUBLIC — โทเคนในลิงก์คือกุญแจ ไม่ต้อง login):
// เห็นสรุปรอบเงินเดือนทั้งงวดเหมือนไฟล์ Payment เดิม + กรอก "ภาษี" ของคนที่ต้องกรอก
// แล้วบันทึกกลับเข้าระบบตรง ๆ — ตัวเลขระบบ (ประมาณการ) โชว์ไว้เป็นตัวช่วยให้ยืนยัน/แก้
// ภาษาไทยล้วน จอมือถือได้ ไม่มีเมนูแอป
interface ReviewRow {
  payslip_id: string;
  name: string;
  employee_code: string | null;
  pay_type: string;
  tax_mode: string;
  salary_satang: number;
  ot_satang: number;
  allowance_satang: number;
  sc_satang: number;
  gross_satang: number;
  deduction_satang: number;
  sso_satang: number;
  tax_satang: number;
  has_override: boolean;
  net_satang: number;
}
interface ReviewData {
  payrun: {
    id: string;
    status: string;
    period_year: number;
    period_month: number;
    cycle_start: string | null;
    cycle_end: string | null;
    pay_date: string | null;
    company: { name: string | null; address: string | null } | null;
  };
  link: { expires_at: string; saved_at: string | null };
  rows: ReviewRow[];
}

const baht = (satang: number) =>
  (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PayrunReviewPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);
  // passcode gate — the accountant enters the code HR shared before any data loads
  const [locked, setLocked] = useState(true);
  const [passcode, setPasscode] = useState('');
  const [checking, setChecking] = useState(false);
  const [passErr, setPassErr] = useState<string | null>(null);
  // draft tax inputs (บาท string) keyed by payslip_id — only CHANGED rows are submitted
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (code: string) => {
    setChecking(true);
    setPassErr(null);
    try {
      const res = await fetch(`/api/hr/payrun-review/${token}?passcode=${encodeURIComponent(code)}`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 401 && json?.locked) {
        setPassErr('รหัสไม่ถูกต้อง');
        return;
      }
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'โหลดไม่สำเร็จ');
      setData(json.data as ReviewData);
      setLocked(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
      setLocked(false); // a non-passcode error (expired/revoked) shows the error card, not the gate
    } finally {
      setChecking(false);
      setLoading(false);
    }
  }, [token]);

  // probe once: if the link itself is dead (expired/revoked/bad), surface that instead of the gate
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/hr/payrun-review/${token}`);
        const json = await res.json().catch(() => ({}));
        if (res.status === 401 && json?.locked) { setLoading(false); return; } // healthy link, needs passcode
        if (!res.ok) { setError(typeof json.error === 'string' ? json.error : 'ลิงก์ใช้ไม่ได้'); setLocked(false); }
      } catch { setError('โหลดไม่สำเร็จ'); setLocked(false); } finally { setLoading(false); }
    })();
  }, [token]);

  const changed = useMemo(() => {
    if (!data) return [];
    return data.rows
      .filter((r) => {
        const d = drafts[r.payslip_id];
        if (d === undefined || d.trim() === '') return false;
        const n = Number(d);
        return Number.isFinite(n) && n >= 0 && Math.round(n * 100) !== r.tax_satang;
      })
      .map((r) => ({ payslip_id: r.payslip_id, tax_satang: Math.round(Number(drafts[r.payslip_id]) * 100) }));
  }, [data, drafts]);

  const save = useCallback(async () => {
    if (changed.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/payrun-review/${token}/taxes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: changed, passcode }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'บันทึกไม่สำเร็จ');
      setDrafts({});
      setSavedBanner(true);
      await load(passcode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }, [changed, token, load, passcode]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <Lock className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm font-semibold text-gray-700">{error}</p>
          <p className="mt-1 text-xs text-gray-400">ลิงก์อาจหมดอายุหรือถูกยกเลิก — ติดต่อ HR เพื่อขอลิงก์ใหม่</p>
        </div>
      </div>
    );
  }

  // passcode gate — shown until the correct code loads the data
  if (locked && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <form
          onSubmit={(e) => { e.preventDefault(); if (passcode.trim()) load(passcode.trim()); }}
          className="w-full max-w-xs rounded-2xl border border-gray-200 bg-white p-7 text-center shadow-sm"
        >
          <Lock className="mx-auto mb-3 h-9 w-9 text-indigo-400" />
          <p className="mb-1 text-sm font-semibold text-gray-800">ใส่รหัสเพื่อเปิดเอกสาร</p>
          <p className="mb-4 text-xs text-gray-400">รหัสที่ HR แจ้งมาพร้อมลิงก์</p>
          <input
            autoFocus
            inputMode="numeric"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="••••"
            className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-center text-lg tracking-[0.4em] outline-none focus:ring-2 focus:ring-indigo-300"
            aria-label="รหัสผ่าน"
          />
          {passErr && <p className="mt-2 text-xs text-red-500">{passErr}</p>}
          <button
            type="submit"
            disabled={checking || !passcode.trim()}
            className="mt-4 w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
          >
            {checking ? '…' : 'เปิด'}
          </button>
        </form>
      </div>
    );
  }
  if (!data) return null;

  const { payrun, rows } = data;
  const period = `${String(payrun.period_month).padStart(2, '0')}/${payrun.period_year}`;
  const readOnly = payrun.status !== 'draft';
  const totals = rows.reduce(
    (a, r) => ({ gross: a.gross + r.gross_satang, sso: a.sso + r.sso_satang, tax: a.tax + r.tax_satang, net: a.net + r.net_satang }),
    { gross: 0, sso: 0, tax: 0, net: 0 }
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-28 text-gray-900">
      {/* header */}
      <div className="border-b border-gray-200 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 shrink-0 text-indigo-500" />
              <h1 className="truncate text-base font-bold">{payrun.company?.name ?? 'รอบเงินเดือน'}</h1>
            </div>
            <p className="text-xs text-gray-500">
              งวด {period} · รอบ {payrun.cycle_start ?? '—'} ถึง {payrun.cycle_end ?? '—'} · จ่าย {payrun.pay_date ?? '—'}
              {readOnly && <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600">ปิดงวดแล้ว — ดูอย่างเดียว</span>}
            </p>
          </div>
          <a
            href={`/api/hr/payrun-review/${token}/export?passcode=${encodeURIComponent(passcode)}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <Download className="h-4 w-4" /> ดาวน์โหลด Excel
          </a>
        </div>
      </div>

      {savedBanner && (
        <div className="mx-auto mt-3 max-w-5xl px-4">
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-5 w-5" /> บันทึกเรียบร้อย — ระบบแจ้ง HR แล้ว ขอบคุณค่ะ/ครับ 🙏
          </div>
        </div>
      )}
      {error && data && (
        <div className="mx-auto mt-3 max-w-5xl px-4">
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        </div>
      )}

      {/* guidance */}
      <div className="mx-auto mt-3 max-w-5xl px-4">
        <p className="text-xs text-gray-500">
          กรอก <span className="font-semibold text-indigo-600">ภาษี (บาท)</span> เฉพาะคนที่ต้องปรับ — ช่องว่าง = ใช้ตัวเลขปัจจุบันตามระบบ ·
          แถวสีเหลือง = โหมดภาษีขั้นบันได (กลุ่มที่มักต้องกรอก)
        </p>
      </div>

      {/* table */}
      <div className="mx-auto mt-2 max-w-5xl px-4">
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-gray-100 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">รหัส</th>
                <th className="px-2 py-2">ชื่อ</th>
                <th className="px-2 py-2 text-right">เงินเดือน</th>
                <th className="px-2 py-2 text-right">OT</th>
                <th className="px-2 py-2 text-right">เบี้ย/อื่นๆ</th>
                <th className="px-2 py-2 text-right">SC</th>
                <th className="px-2 py-2 text-right">รวมรับ</th>
                <th className="px-2 py-2 text-right">หักอื่น</th>
                <th className="px-2 py-2 text-right">สปส.</th>
                <th className="px-2 py-2 text-right">ภาษีปัจจุบัน</th>
                <th className="px-2 py-2 text-right">ภาษีใหม่ (บาท)</th>
                <th className="px-2 py-2 text-right">สุทธิ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => {
                const progressive = r.tax_mode === 'progressive';
                return (
                  <tr key={r.payslip_id} className={progressive ? 'bg-amber-50/60' : 'bg-white'}>
                    <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                    <td className="px-2 py-1.5 tabular-nums text-gray-500">{r.employee_code ?? '—'}</td>
                    <td className="max-w-40 truncate px-2 py-1.5 font-medium">{r.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{baht(r.salary_satang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{baht(r.ot_satang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{baht(r.allowance_satang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{baht(r.sc_satang)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{baht(r.gross_satang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{baht(r.deduction_satang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{baht(r.sso_satang)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {baht(r.tax_satang)}
                      {r.has_override && <span className="ml-1 text-[10px] text-emerald-600">✓</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={readOnly}
                        value={drafts[r.payslip_id] ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.payslip_id]: e.target.value }))}
                        placeholder={baht(r.tax_satang)}
                        className={`w-24 rounded-lg border px-2 py-1 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-indigo-300 ${progressive ? 'border-amber-300 bg-white' : 'border-gray-200 bg-gray-50'} disabled:opacity-40`}
                        aria-label={`ภาษีของ ${r.name}`}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{baht(r.net_satang)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 text-xs font-bold">
              <tr>
                <td colSpan={7} className="px-2 py-2 text-right text-gray-500">รวมทั้งงวด</td>
                <td className="px-2 py-2 text-right tabular-nums">{baht(totals.gross)}</td>
                <td />
                <td className="px-2 py-2 text-right tabular-nums">{baht(totals.sso)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{baht(totals.tax)}</td>
                <td />
                <td className="px-2 py-2 text-right tabular-nums">{baht(totals.net)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          ลิงก์นี้ใช้ได้ถึง {new Date(data.link.expires_at).toLocaleDateString('th-TH')} · เอกสารภายใน — ห้ามส่งต่อ
        </p>
      </div>

      {/* sticky save bar */}
      {!readOnly && (
        <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              {changed.length > 0 ? `แก้ไขภาษี ${changed.length} รายการ` : 'ยังไม่มีรายการแก้ไข'}
            </p>
            <button
              type="button"
              onClick={save}
              disabled={changed.length === 0 || saving}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              บันทึกส่งให้ HR
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
