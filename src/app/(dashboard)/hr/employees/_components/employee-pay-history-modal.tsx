'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, ChevronLeft, Archive } from 'lucide-react';
import { Modal, EmptyState, DataList, DataCard, MoneyValue, Button, toast } from '@/components/ui';
import { ImportedPayslipView, periodLabel, type ImportedSlip } from '@/components/hr/imported-payslip-view';

// Per-employee historical (imported) payslips — the legacy monthly figures matched to
// this person. Read-only: list of months → one slip. Self-contained locale strings.
interface Props {
  employeeId: string | null;
  employeeName: string;
  onClose: () => void;
}

export function EmployeePayHistoryModal({ employeeId, employeeName, onClose }: Props) {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'ประวัติเงินเดือน (นำเข้า)', empty: 'ไม่มีสลิปย้อนหลัง', loadFailed: 'โหลดไม่สำเร็จ', back: 'ย้อนกลับ' }
    : { title: 'Pay history (imported)', empty: 'No historical payslips', loadFailed: 'Load failed', back: 'Back' };

  const [rows, setRows] = useState<ImportedSlip[]>([]);
  const [loading, setLoading] = useState(false);
  const [slip, setSlip] = useState<ImportedSlip | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/imported-payslips?employee_id=${id}`);
      const json = await res.json();
      if (!res.ok) { toast({ type: 'error', title: json?.error || L.loadFailed }); setRows([]); return; }
      setRows((json.data ?? []) as ImportedSlip[]);
    } catch {
      toast({ type: 'error', title: L.loadFailed });
    } finally {
      setLoading(false);
    }
  }, [L.loadFailed]);

  useEffect(() => { if (employeeId) { setSlip(null); load(employeeId); } }, [employeeId, load]);

  if (!employeeId) return null;

  return (
    <Modal isOpen onClose={onClose} title={`${L.title} · ${employeeName}`} size="lg">
      <div className="max-h-[70vh] overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : slip ? (
          <div className="space-y-3">
            <Button variant="ghost" size="sm" onClick={() => setSlip(null)} icon={<ChevronLeft className="h-4 w-4" />}>{L.back}</Button>
            <ImportedPayslipView data={slip} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Archive} title={L.empty} />
        ) : (
          <DataList>
            {rows.map((r) => (
              <DataCard
                key={r.id}
                onClick={() => setSlip(r)}
                title={periodLabel(r.period_year, r.period_month, isTh)}
                subtitle={r.position_text || undefined}
                value={<MoneyValue satang={r.net_satang ?? 0} emphasis="strong" tone="good" />}
              />
            ))}
          </DataList>
        )}
      </div>
    </Modal>
  );
}
