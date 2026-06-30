'use client';

import { useState } from 'react';
import { Button, Input, Modal, ModalFooter, toast } from '@/components/ui';
import { formatBaht, bahtToSatang } from '@/lib/pos/money';

interface Props {
  orderId: string;
  totalSatang: number;
  onClose: () => void;
  onPaid: () => void;
}

const QUICK = [100, 500, 1000];

export function CheckoutModal({ orderId, totalSatang, onClose, onPaid }: Props) {
  const [tendered, setTendered] = useState('');
  const [saving, setSaving] = useState(false);

  const tenderedSatang = tendered ? bahtToSatang(Number(tendered)) : 0;
  const changeSatang = Math.max(0, tenderedSatang - totalSatang);
  const enough = tenderedSatang >= totalSatang;

  const pay = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/pos/orders/${orderId}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'cash', tenderedSatang: tendered ? tenderedSatang : undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'คิดเงินไม่สำเร็จ');
      toast({ type: 'success', title: 'รับเงินแล้ว', message: d.changeSatang ? `เงินทอน ฿${formatBaht(d.changeSatang)}` : 'พอดี' });
      onPaid();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="รับเงิน (เงินสด)" size="sm">
      <div className="space-y-4">
        <div className="rounded-xl bg-indigo-50 p-4 text-center dark:bg-indigo-900/20">
          <p className="text-xs text-indigo-500">ยอดที่ต้องชำระ</p>
          <p className="font-mono text-3xl font-bold text-indigo-700 dark:text-indigo-300">฿{formatBaht(totalSatang)}</p>
        </div>
        <Input label="รับเงินมา (บาท)" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder="0" inputMode="decimal" />
        <div className="flex gap-2">
          {QUICK.map((v) => (
            <button key={v} type="button" onClick={() => setTendered(String(v))} className="flex-1 rounded-lg border border-gray-200 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
              {v.toLocaleString()}
            </button>
          ))}
          <button type="button" onClick={() => setTendered(String(totalSatang / 100))} className="flex-1 rounded-lg border border-gray-200 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            พอดี
          </button>
        </div>
        {tendered && (
          <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5 dark:bg-gray-800">
            <span className="text-sm text-gray-500">เงินทอน</span>
            <span className={`font-mono text-lg font-bold ${enough ? 'text-emerald-600' : 'text-rose-500'}`}>
              {enough ? `฿${formatBaht(changeSatang)}` : 'เงินไม่พอ'}
            </span>
          </div>
        )}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={pay} isLoading={saving} disabled={!!tendered && !enough}>ยืนยันรับเงิน</Button>
      </ModalFooter>
    </Modal>
  );
}
