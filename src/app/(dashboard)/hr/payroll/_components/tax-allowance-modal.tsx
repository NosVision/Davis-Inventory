'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button, Modal, ModalFooter, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { formatBaht, bahtToSatang } from '@/lib/pos/money';

// ล.ย.01 personal tax allowances (per employee, per tax year). Backend:
// /api/hr/employees/[id]/tax-allowances (GET/POST/PATCH/DELETE). Amounts are ANNUAL satang.
interface AllowanceItem {
  id: string;
  tax_year: number;
  kind: string;
  label: string | null;
  amount_satang: number;
  active: boolean;
}
interface TaxAllowanceModalProps {
  employeeId: string;
  name: string;
  onClose: () => void;
}

// Kind labels are fixed domain terms; kept locale-aware here to avoid a large i18n block.
const KINDS: { value: string; th: string; en: string }[] = [
  { value: 'spouse', th: 'คู่สมรส', en: 'Spouse' },
  { value: 'child', th: 'บุตร', en: 'Child' },
  { value: 'parent', th: 'บิดามารดา', en: 'Parent' },
  { value: 'disabled_dependant', th: 'ผู้พิการในอุปการะ', en: 'Disabled dependant' },
  { value: 'life_insurance', th: 'ประกันชีวิต', en: 'Life insurance' },
  { value: 'health_insurance', th: 'ประกันสุขภาพ', en: 'Health insurance' },
  { value: 'parent_health_insurance', th: 'ประกันสุขภาพบิดามารดา', en: 'Parent health insurance' },
  { value: 'provident_fund', th: 'กองทุนสำรองเลี้ยงชีพ', en: 'Provident fund' },
  { value: 'rmf', th: 'RMF', en: 'RMF' },
  { value: 'ssf', th: 'SSF', en: 'SSF' },
  { value: 'home_loan_interest', th: 'ดอกเบี้ยกู้ยืมที่อยู่อาศัย', en: 'Home-loan interest' },
  { value: 'social_enterprise', th: 'วิสาหกิจเพื่อสังคม', en: 'Social enterprise' },
  { value: 'donation', th: 'เงินบริจาค', en: 'Donation' },
  { value: 'other', th: 'อื่น ๆ', en: 'Other' },
];
const inputCls =
  'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

const CURRENT_YEAR = new Date().getUTCFullYear();

export function TaxAllowanceModal({ employeeId, name, onClose }: TaxAllowanceModalProps) {
  const locale = useLocale();
  const isTh = locale === 'th';
  const L = isTh
    ? { title: 'ลดหย่อนภาษี (ล.ย.01)', empty: 'ยังไม่มีรายการลดหย่อน', add: 'เพิ่ม', close: 'ปิด', amount: 'จำนวน/ปี (บาท)', year: 'ปีภาษี', remove: 'ลบ', on: 'ใช้งาน', off: 'ปิด', invalid: 'กรอกจำนวนให้ถูกต้อง', saveFailed: 'บันทึกไม่สำเร็จ', added: 'เพิ่มแล้ว', removed: 'ลบแล้ว' }
    : { title: 'Tax allowances (ล.ย.01)', empty: 'No allowances yet', add: 'Add', close: 'Close', amount: 'Amount/yr (THB)', year: 'Tax year', remove: 'Remove', on: 'Active', off: 'Off', invalid: 'Enter a valid amount', saveFailed: 'Save failed', added: 'Added', removed: 'Removed' };
  const kindLabel = (v: string) => { const k = KINDS.find((x) => x.value === v); return k ? (isTh ? k.th : k.en) : v; };

  const [items, setItems] = useState<AllowanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState('spouse');
  const [amountBaht, setAmountBaht] = useState('');
  const [taxYear, setTaxYear] = useState(String(CURRENT_YEAR));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/tax-allowances`);
      const json = await res.json();
      setItems((json.data ?? []) as AllowanceItem[]);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const add = useCallback(async () => {
    const amt = Number(amountBaht);
    const year = Number(taxYear);
    if (!Number.isFinite(amt) || amt <= 0 || !Number.isInteger(year)) {
      toast({ type: 'warning', title: L.invalid });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/tax-allowances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, amount_satang: bahtToSatang(amt), tax_year: year, label: kindLabel(kind) }),
      });
      if (!res.ok) { toast({ type: 'error', title: L.saveFailed }); return; }
      toast({ type: 'success', title: L.added });
      setAmountBaht('');
      await load();
    } finally {
      setSaving(false);
    }
  }, [amountBaht, taxYear, kind, employeeId, load, L, kindLabel]);

  const toggleActive = useCallback(async (it: AllowanceItem) => {
    const res = await fetch(`/api/hr/employees/${employeeId}/tax-allowances`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: it.id, active: !it.active }),
    });
    if (!res.ok) { toast({ type: 'error', title: L.saveFailed }); return; }
    await load();
  }, [employeeId, load, L]);

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`/api/hr/employees/${employeeId}/tax-allowances?item_id=${id}`, { method: 'DELETE' });
    if (!res.ok) { toast({ type: 'error', title: L.saveFailed }); return; }
    toast({ type: 'success', title: L.removed });
    await load();
  }, [employeeId, load, L]);

  return (
    <Modal isOpen onClose={onClose} title={`${L.title} · ${name}`} size="md">
      <div className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-6 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-400">{L.empty}</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <span className="text-gray-900 dark:text-white">{it.label || kindLabel(it.kind)}</span>
                  <span className="ml-2 text-xs text-gray-400">{it.tax_year}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-gray-700 dark:text-gray-200">{formatBaht(it.amount_satang)} ฿</span>
                  <button
                    onClick={() => toggleActive(it)}
                    className={cn('rounded px-2 py-0.5 text-xs font-medium', it.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400')}
                  >
                    {it.active ? L.on : L.off}
                  </button>
                  <button onClick={() => remove(it.id)} aria-label={L.remove} title={L.remove} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* add form */}
        <div className="space-y-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-600">
          <div className="grid grid-cols-2 gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
              {KINDS.map((k) => (<option key={k.value} value={k.value}>{isTh ? k.th : k.en}</option>))}
            </select>
            <input type="number" inputMode="numeric" min={CURRENT_YEAR - 5} max={CURRENT_YEAR + 1} value={taxYear} onChange={(e) => setTaxYear(e.target.value)} placeholder={L.year} aria-label={L.year} className={inputCls} />
          </div>
          <div className="flex items-center gap-2">
            <input type="number" inputMode="decimal" min={0} step={0.01} value={amountBaht} onChange={(e) => setAmountBaht(e.target.value)} placeholder={L.amount} aria-label={L.amount} className={cn('flex-1', inputCls)} />
            <span className="text-sm text-gray-500">฿</span>
            <Button size="sm" onClick={add} isLoading={saving} icon={<Plus className="h-4 w-4" />}>{L.add}</Button>
          </div>
        </div>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>{L.close}</Button>
      </ModalFooter>
    </Modal>
  );
}
