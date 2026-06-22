'use client';

import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { Button, Modal, ModalFooter, toast } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/stores/app-store';
import {
  REPAIR_STATUS_LABELS,
  REPAIR_RESOLUTION_LABELS,
  CLOSED_REPAIR_STATUSES,
} from '@/lib/repairs/status';
import type { RepairRequest, MaintenanceOccurrence } from '@/types/database';
import type { RepairReportData } from './repair-report-pdf';

const MAINTENANCE_STATUS_LABELS: Record<string, string> = {
  pending: 'รอดำเนินการ',
  completed: 'เสร็จแล้ว',
  skipped: 'ข้าม',
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function RepairReportExport() {
  const { currentStoreId } = useAppStore();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(currentMonth());
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (!currentStoreId) {
      toast({ type: 'error', title: 'กรุณาเลือกสาขา' });
      return;
    }
    setExporting(true);
    try {
      const supabase = createClient();
      const [y, m] = month.split('-').map(Number);
      const start = `${month}-01`;
      const nextMonth = new Date(y, m, 1);
      const end = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

      const [storeRes, repairsRes, maintRes] = await Promise.all([
        supabase.from('stores').select('store_name').eq('id', currentStoreId).maybeSingle(),
        supabase
          .from('repair_requests')
          .select('*')
          .eq('store_id', currentStoreId)
          .gte('created_at', start)
          .lt('created_at', end)
          .order('created_at', { ascending: true }),
        supabase
          .from('maintenance_occurrences')
          .select('*, schedule:maintenance_schedules(title)')
          .eq('store_id', currentStoreId)
          .gte('due_date', start)
          .lt('due_date', end)
          .order('due_date', { ascending: true }),
      ]);

      const repairs = (repairsRes.data as RepairRequest[]) ?? [];
      const maint = (maintRes.data as (MaintenanceOccurrence & { schedule: { title: string } | null })[]) ?? [];

      const completed = repairs.filter((r) => r.status === 'completed').length;
      const open = repairs.filter((r) => !CLOSED_REPAIR_STATUSES.includes(r.status)).length;
      const needsPurchase = repairs.filter((r) => r.resolution === 'needs_purchase').length;
      const totalCost = repairs.reduce((s, r) => s + (Number(r.estimated_cost) || 0), 0);
      const maintenanceDone = maint.filter((m) => m.status === 'completed').length;

      const monthLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
        month: 'long',
        year: 'numeric',
      }).format(new Date(y, m - 1, 1));
      const generatedAtLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date());

      const data: RepairReportData = {
        store_name: (storeRes.data as { store_name?: string } | null)?.store_name || 'สาขา',
        month_label: monthLabel,
        generated_at_label: generatedAtLabel,
        repairs: repairs.map((r) => ({
          date: r.created_at.slice(0, 10),
          title: r.title,
          status: REPAIR_STATUS_LABELS[r.status],
          resolution: r.resolution ? REPAIR_RESOLUTION_LABELS[r.resolution] : '-',
          cost: r.estimated_cost,
        })),
        maintenance: maint.map((m) => ({
          date: m.due_date,
          title: m.schedule?.title ?? 'งานประจำ',
          status: MAINTENANCE_STATUS_LABELS[m.status] ?? m.status,
        })),
        summary: {
          total: repairs.length,
          completed,
          open,
          needsPurchase,
          totalCost,
          maintenanceTotal: maint.length,
          maintenanceDone,
        },
      };

      const mod = await import('./repair-report-pdf');
      const blob = await mod.buildRepairReportPdf(data);
      mod.downloadBlob(blob, `รายงานซ่อม-${data.store_name}-${month}.pdf`);
      setOpen(false);
    } catch (err) {
      console.error('Repair PDF export error:', err);
      toast({ type: 'error', title: 'สร้าง PDF ล้มเหลว' });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        รายงาน PDF
      </Button>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="ดาวน์โหลดรายงานเดือน"
        description="สรุปงานซ่อมและงานประจำของสาขาในเดือนที่เลือก"
        size="sm"
      >
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">เดือน</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>ยกเลิก</Button>
          <Button variant="primary" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            ดาวน์โหลด PDF
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
