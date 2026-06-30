'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, Input, Select, toast } from '@/components/ui';
import type { PosSettings } from '@/types/pos';

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }));

export function PosSettingsPanel({ storeId, isManager }: { storeId: string; isManager: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [servicePct, setServicePct] = useState('0');
  const [vatPct, setVatPct] = useState('0');
  const [vatInclusive, setVatInclusive] = useState(false);
  const [svcTaxable, setSvcTaxable] = useState(true);
  const [cutoff, setCutoff] = useState('6');

  useEffect(() => {
    fetch(`/api/pos/settings?storeId=${storeId}`)
      .then((r) => r.json())
      .then((d) => {
        const s = d.settings as PosSettings;
        setServicePct(String(Math.round(s.service_rate * 10000) / 100));
        setVatPct(String(Math.round(s.vat_rate * 10000) / 100));
        setVatInclusive(s.vat_inclusive);
        setSvcTaxable(s.service_charge_taxable);
        setCutoff(String(s.business_day_cutoff_hour));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [storeId]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/pos/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          serviceRate: (Number(servicePct) || 0) / 100,
          vatRate: (Number(vatPct) || 0) / 100,
          vatInclusive,
          serviceChargeTaxable: svcTaxable,
          businessDayCutoffHour: Number(cutoff) || 6,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'บันทึกไม่สำเร็จ');
      toast({ type: 'success', title: 'บันทึกแล้ว' });
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>;

  return (
    <div className="max-w-md space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Service Charge (%)" value={servicePct} onChange={(e) => setServicePct(e.target.value)} inputMode="decimal" disabled={!isManager} />
        <Input label="VAT (%)" value={vatPct} onChange={(e) => setVatPct(e.target.value)} inputMode="decimal" disabled={!isManager} />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input type="checkbox" checked={vatInclusive} onChange={(e) => setVatInclusive(e.target.checked)} disabled={!isManager} className="h-4 w-4 rounded" />
        ราคาเมนูรวม VAT แล้ว (ไม่บวกเพิ่ม — VAT แสดงแยกในใบเสร็จ)
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input type="checkbox" checked={svcTaxable} onChange={(e) => setSvcTaxable(e.target.checked)} disabled={!isManager} className="h-4 w-4 rounded" />
        คิด VAT บน (ยอด + Service Charge)
      </label>
      <Select label="เวลาตัดวันทำการ (รอบขาย)" value={cutoff} onChange={(e) => setCutoff(e.target.value)} options={HOURS} disabled={!isManager} />
      <p className="rounded-lg bg-gray-50 p-2.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        เวลาตัดวัน = รอบขายสิ้นสุด เช่น 06:00 หมายถึงขายถึงตี 6 นับเป็นวันก่อน (เหมือนระบบนับสต๊อกเดิม)
      </p>
      {isManager && (
        <div className="flex justify-end">
          <Button onClick={save} isLoading={saving}>บันทึก</Button>
        </div>
      )}
    </div>
  );
}
