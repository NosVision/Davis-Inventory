'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, Building2, Percent, Divide, Clock3 } from 'lucide-react';
import { Button, Modal, ModalFooter, PageHeader, StatusBadge, toast } from '@/components/ui';

// Company settings (owner ask 2026-07-05 "ปรับได้เกือบทุกจุด"): the per-entity payroll knobs the
// engine already reads (SSO rate/ceiling, day divisor, OT multiplier, slip paper) + address and
// tax id for statutory documents. Money-field changes require a reason (audited).
interface Company {
  id: string;
  name: string;
  name_en: string | null;
  address: string | null;
  phone: string | null;
  tax_id: string | null;
  payslip_paper: string | null;
  sso_rate: number;
  sso_wage_ceiling_satang: number;
  day_divisor: number;
  ot_multipliers: { ot1?: number } | null;
  wht_rate: number;
  sso_prorate: boolean;
  active: boolean;
}

export default function HrCompaniesPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'บริษัท & กติกาเงินเดือน', subtitle: 'ค่าเหล่านี้ใช้คำนวณเงินเดือนจริงของแต่ละบริษัท — แก้ได้โดยไม่ต้องแก้โค้ด', edit: 'แก้ไข', name: 'ชื่อบริษัท', nameEn: 'ชื่อบริษัท (อังกฤษ — หัวหนังสือรับรอง)', phone: 'เบอร์โทร (ท้ายหนังสือรับรอง)', address: 'ที่อยู่ (หัวสลิป/รายงาน)', taxId: 'เลขผู้เสียภาษี (13 หลัก)', paper: 'ขนาดกระดาษสลิป', ssoRate: 'อัตรา สปส. (%)', ssoCeiling: 'เพดานค่าจ้าง สปส. (บาท/เดือน)', dayDivisor: 'ตัวหารรายวัน (÷)', ot1: 'ตัวคูณ OT วันปกติ (×)', whtRate: 'อัตราภาษีหัก ณ ที่จ่าย 3% (%)', ssoProrate: 'คิด สปส. ตามยอด prorate (เข้า/ออกกลางเดือน)', ssoProrateHint: 'ปิด = คิดจากเรตเต็ม · เปิด = คิดจากเงินเดือนที่ได้จริงตามวันทำงาน (เหมือน PVD)', reason: 'เหตุผล (บังคับเมื่อแก้ค่าที่มีผลต่อเงินเดือน)', save: 'บันทึก', cancel: 'ยกเลิก', saved: 'บันทึกแล้ว', failed: 'บันทึกไม่สำเร็จ', loadFailed: 'โหลดไม่สำเร็จ', inactive: 'ปิดใช้งาน', needReason: 'กรุณากรอกเหตุผลเมื่อแก้ค่าเงินเดือน', hintMoney: 'มีผลกับสลิปตั้งแต่รอบถัดไปที่กด "สร้าง/คำนวณใหม่"' }
    : { title: 'Companies & payroll parameters', subtitle: 'These values drive real payslip math per entity — editable without code changes', edit: 'Edit', name: 'Company name', nameEn: 'Company name (English — certificate letterhead)', phone: 'Phone (certificate footer)', address: 'Address (slip/report header)', taxId: 'Tax ID (13 digits)', paper: 'Payslip paper', ssoRate: 'SSO rate (%)', ssoCeiling: 'SSO wage ceiling (THB/month)', dayDivisor: 'Daily divisor (÷)', ot1: 'Weekday OT multiplier (×)', whtRate: 'Withholding tax rate 3% (%)', ssoProrate: 'Prorate SSO for mid-month hires/leavers', ssoProrateHint: 'Off = full monthly rate · On = the salary actually earned by days worked (like PVD)', reason: 'Reason (required when changing payroll values)', save: 'Save', cancel: 'Cancel', saved: 'Saved', failed: 'Save failed', loadFailed: 'Load failed', inactive: 'Inactive', needReason: 'A reason is required when changing payroll values', hintMoney: 'Applies to slips from the next generate/recompute' };

  const [rows, setRows] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', name_en: '', address: '', phone: '', tax_id: '', payslip_paper: '', sso_pct: '', ceiling_baht: '', day_divisor: '', ot1: '', wht_pct: '', reason: '' });
  const [ssoProrate, setSsoProrate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/companies');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error);
      setRows((json.data ?? []) as Company[]);
    } catch {
      toast({ type: 'error', title: L.loadFailed });
    } finally {
      setLoading(false);
    }
  }, [L.loadFailed]);

  useEffect(() => { load(); }, [load]);

  const openEdit = (c: Company) => {
    setForm({
      name: c.name,
      name_en: c.name_en ?? '',
      address: c.address ?? '',
      phone: c.phone ?? '',
      tax_id: c.tax_id ?? '',
      payslip_paper: c.payslip_paper ?? '',
      sso_pct: String((Number(c.sso_rate) || 0) * 100),
      ceiling_baht: String((Number(c.sso_wage_ceiling_satang) || 0) / 100),
      day_divisor: String(c.day_divisor ?? 30),
      ot1: String(c.ot_multipliers?.ot1 ?? 1.5),
      wht_pct: String((Number(c.wht_rate) || 0.03) * 100),
      reason: '',
    });
    setSsoProrate(c.sso_prorate ?? false);
    setEditing(c);
  };

  const moneyChanged = editing
    ? Number(form.sso_pct) !== (Number(editing.sso_rate) || 0) * 100 ||
      Number(form.ceiling_baht) !== (Number(editing.sso_wage_ceiling_satang) || 0) / 100 ||
      Number(form.day_divisor) !== (editing.day_divisor ?? 30) ||
      Number(form.ot1) !== (editing.ot_multipliers?.ot1 ?? 1.5) ||
      Number(form.wht_pct) !== (Number(editing.wht_rate) || 0.03) * 100 ||
      ssoProrate !== (editing.sso_prorate ?? false)
    : false;

  const save = async () => {
    if (!editing) return;
    if (moneyChanged && !form.reason.trim()) {
      toast({ type: 'error', title: L.needReason });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/companies/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          name_en: form.name_en,
          address: form.address,
          phone: form.phone,
          tax_id: form.tax_id,
          payslip_paper: form.payslip_paper,
          sso_rate: (Number(form.sso_pct) || 0) / 100,
          sso_wage_ceiling_satang: Math.round((Number(form.ceiling_baht) || 0) * 100),
          day_divisor: Number(form.day_divisor) || 30,
          ot1_multiplier: Number(form.ot1) || 1.5,
          wht_rate: (Number(form.wht_pct) || 0) / 100,
          sso_prorate: ssoProrate,
          reason: form.reason.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
      toast({ type: 'success', title: L.saved });
      setEditing(null);
      await load();
    } catch (e) {
      toast({ type: 'error', title: L.failed, message: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeader title={L.title} subtitle={L.subtitle} />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((c) => (
            <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Building2 className="h-5 w-5 shrink-0 text-indigo-500" />
                  <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{c.name}</h2>
                </div>
                {!c.active && <StatusBadge tone="neutral" label={L.inactive} />}
              </div>
              <dl className="mb-3 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-1.5"><Percent className="h-3.5 w-3.5" /> สปส. {(Number(c.sso_rate) * 100).toFixed(1)}% · เพดาน ฿{((c.sso_wage_ceiling_satang || 0) / 100).toLocaleString()}</div>
                <div className="flex items-center gap-1.5"><Divide className="h-3.5 w-3.5" /> ÷{c.day_divisor ?? 30} · <Clock3 className="h-3.5 w-3.5" /> OT ×{c.ot_multipliers?.ot1 ?? 1.5} · หัก ณ ที่จ่าย {((Number(c.wht_rate) || 0.03) * 100).toFixed(1)}%</div>
                <div className="truncate">{c.tax_id ? `เลขภาษี ${c.tax_id}` : <span className="text-amber-500">⚠ ยังไม่ระบุเลขภาษี</span>} · {c.address ? c.address : <span className="text-amber-500">⚠ ยังไม่ระบุที่อยู่</span>}</div>
              </dl>
              <Button size="sm" variant="outline" onClick={() => openEdit(c)}>{L.edit}</Button>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={editing?.name ?? ''} size="md">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2 text-xs font-medium text-gray-600 dark:text-gray-300">{L.name}
            <input value={form.name} onChange={upd('name')} className="control mt-1 w-full" />
          </label>
          <label className="sm:col-span-2 text-xs font-medium text-gray-600 dark:text-gray-300">{L.nameEn}
            <input value={form.name_en} onChange={upd('name_en')} className="control mt-1 w-full" placeholder="COMPANY CO., LTD." />
          </label>
          <label className="sm:col-span-2 text-xs font-medium text-gray-600 dark:text-gray-300">{L.address}
            <input value={form.address} onChange={upd('address')} className="control mt-1 w-full" />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{L.phone}
            <input value={form.phone} onChange={upd('phone')} className="control mt-1 w-full" placeholder="02-000-0000" />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{L.taxId}
            <input value={form.tax_id} onChange={upd('tax_id')} maxLength={13} className="control mt-1 w-full" placeholder="0105500000000" />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{L.paper}
            <input value={form.payslip_paper} onChange={upd('payslip_paper')} className="control mt-1 w-full" placeholder="9x5.5" />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{L.ssoRate}
            <input type="number" step="0.1" min="0" max="10" value={form.sso_pct} onChange={upd('sso_pct')} className="control mt-1 w-full" />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{L.ssoCeiling}
            <input type="number" step="100" min="0" value={form.ceiling_baht} onChange={upd('ceiling_baht')} className="control mt-1 w-full" />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{L.dayDivisor}
            <input type="number" step="1" min="1" max="31" value={form.day_divisor} onChange={upd('day_divisor')} className="control mt-1 w-full" />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{L.ot1}
            <input type="number" step="0.5" min="1" max="5" value={form.ot1} onChange={upd('ot1')} className="control mt-1 w-full" />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{L.whtRate}
            <input type="number" step="0.1" min="0" max="20" value={form.wht_pct} onChange={upd('wht_pct')} className="control mt-1 w-full" />
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-2.5 sm:col-span-2 dark:border-gray-700">
            <input
              type="checkbox"
              checked={ssoProrate}
              onChange={(e) => setSsoProrate(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {L.ssoProrate}
              <span className="mt-0.5 block text-[11px] font-normal text-gray-400">{L.ssoProrateHint}</span>
            </span>
          </label>
          {moneyChanged && (
            <label className="sm:col-span-2 text-xs font-medium text-amber-600 dark:text-amber-400">{L.reason}
              <input value={form.reason} onChange={upd('reason')} className="control mt-1 w-full" />
              <span className="mt-1 block text-[11px] font-normal text-gray-400">{L.hintMoney}</span>
            </label>
          )}
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setEditing(null)}>{L.cancel}</Button>
          <Button onClick={save} isLoading={saving}>{L.save}</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
