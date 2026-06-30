'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal, ModalFooter, Button, Input, Textarea, toast } from '@/components/ui';
import { formatBaht, bahtToSatang } from '@/lib/pos/money';
import type { PosShift } from '@/types/pos';

interface ShiftReport {
  bills: number;
  salesSatang: number;
  cashSatang: number;
  promptpaySatang: number;
  cardSatang: number;
  discountSatang: number;
  serviceSatang: number;
  vatSatang: number;
}

const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
  <div className={`flex justify-between ${bold ? 'text-base font-bold' : 'text-sm text-gray-600 dark:text-gray-300'}`}>
    <span>{label}</span>
    <span className="font-mono">{value}</span>
  </div>
);

export function PosShiftPanel({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [shift, setShift] = useState<PosShift | null>(null);
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<{ shift: PosShift; report: ShiftReport } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/shifts?storeId=${storeId}`);
      const d = await res.json();
      const s = (d.shift as PosShift | null) ?? null;
      setShift(s);
      if (s) {
        const r = await fetch(`/api/pos/shifts/${s.id}/report`);
        const rd = await r.json();
        if (r.ok) setReport(rd.report);
      }
    } finally {
      setLoading(false);
    }
  }, [storeId]);
  useEffect(() => {
    load();
  }, [load]);

  const openShift = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/pos/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, openingCashSatang: openingCash ? bahtToSatang(Number(openingCash)) : 0 }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'เปิดกะไม่สำเร็จ');
      toast({ type: 'success', title: 'เปิดกะแล้ว' });
      load();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const closeShift = async () => {
    if (!shift) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pos/shifts/${shift.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closingCashSatang: closingCash ? bahtToSatang(Number(closingCash)) : 0, note }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'ปิดกะไม่สำเร็จ');
      toast({ type: 'success', title: 'ปิดกะแล้ว' });
      setClosed({ shift: d.shift, report: d.report });
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="กะ / ปิดรอบ" size="sm">
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
      ) : closed ? (
        <div className="space-y-2">
          <p className="rounded-lg bg-emerald-50 p-2.5 text-center text-sm font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">ปิดกะแล้ว · สรุปยอด (Z)</p>
          <Row label="ยอดขายรวม" value={`฿${formatBaht(closed.report.salesSatang)}`} bold />
          <Row label="จำนวนบิล" value={String(closed.report.bills)} />
          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
          <Row label="เงินสด" value={`฿${formatBaht(closed.report.cashSatang)}`} />
          <Row label="พร้อมเพย์" value={`฿${formatBaht(closed.report.promptpaySatang)}`} />
          <Row label="บัตร" value={`฿${formatBaht(closed.report.cardSatang)}`} />
          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
          <Row label="เงินต้นลิ้นชัก" value={`฿${formatBaht(closed.shift.opening_cash_satang)}`} />
          <Row label="เงินคาด (ต้น+สด)" value={`฿${formatBaht(closed.shift.expected_cash_satang ?? 0)}`} />
          <Row label="นับได้จริง" value={`฿${formatBaht(closed.shift.closing_cash_satang ?? 0)}`} />
          {(() => {
            const diff = (closed.shift.closing_cash_satang ?? 0) - (closed.shift.expected_cash_satang ?? 0);
            return <Row label={diff === 0 ? 'พอดี' : diff > 0 ? 'เกิน' : 'ขาด'} value={`${diff < 0 ? '−' : ''}฿${formatBaht(Math.abs(diff))}`} bold />;
          })()}
        </div>
      ) : shift ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">เปิดกะเมื่อ {new Date(shift.opened_at).toLocaleString('th-TH')} · เงินต้น ฿{formatBaht(shift.opening_cash_satang)}</p>
          {report && (
            <div className="space-y-1 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <Row label="ยอดขาย (กะนี้)" value={`฿${formatBaht(report.salesSatang)}`} bold />
              <Row label="บิล" value={String(report.bills)} />
              <Row label="เงินสด" value={`฿${formatBaht(report.cashSatang)}`} />
              <Row label="พร้อมเพย์ / บัตร" value={`฿${formatBaht(report.promptpaySatang)} / ฿${formatBaht(report.cardSatang)}`} />
              <Row label="เงินคาดในลิ้นชัก" value={`฿${formatBaht(shift.opening_cash_satang + report.cashSatang)}`} bold />
            </div>
          )}
          <Input label="นับเงินจริงในลิ้นชัก (บาท)" value={closingCash} onChange={(e) => setClosingCash(e.target.value)} inputMode="decimal" placeholder="0" />
          <Textarea label="หมายเหตุ" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">ยังไม่มีกะที่เปิดอยู่</p>
          <Input label="เงินต้นในลิ้นชัก (บาท)" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} inputMode="decimal" placeholder="0" />
        </div>
      )}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ปิด</Button>
        {!closed && !loading && (shift ? (
          <Button onClick={closeShift} isLoading={busy}>ปิดกะ</Button>
        ) : (
          <Button onClick={openShift} isLoading={busy}>เปิดกะ</Button>
        ))}
      </ModalFooter>
    </Modal>
  );
}
