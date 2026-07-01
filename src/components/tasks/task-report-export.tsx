'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileDown, Loader2 } from 'lucide-react';
import { Button, Modal, ModalFooter, toast } from '@/components/ui';
import { CLOSED_TASK_STATUSES } from '@/lib/tasks/status';
import type { TaskStatus, TaskWithRelations } from '@/types/tasks';

// รายงาน PDF เป็นภาษาไทยเสมอ (นอกขอบเขต i18n) — เก็บป้ายสถานะไทยไว้ในไฟล์นี้เอง
const TASK_STATUS_LABELS_TH: Record<TaskStatus, string> = {
  scheduled: 'รอเริ่ม',
  pending_approval: 'รออนุมัติ',
  in_progress: 'กำลังดำเนินการ',
  done: 'เสร็จสิ้น',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function TaskReportExport({ roomId, roomName }: { roomId: string; roomName: string }) {
  const t = useTranslations('tasks');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(currentMonth());
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch(`/api/tasks?roomId=${roomId}`);
      const data = await res.json();
      const all = (data.tasks ?? []) as TaskWithRelations[];
      const rows = all.filter((t) => (t.created_at ?? '').slice(0, 7) === month);

      const [y, m] = month.split('-').map(Number);
      const monthLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
      const generatedAtLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      }).format(new Date());

      const reportData = {
        room_name: roomName,
        month_label: monthLabel,
        generated_at_label: generatedAtLabel,
        rows: rows.map((t) => ({
          ticket: t.ticket_no,
          date: (t.created_at ?? '').slice(0, 10),
          title: t.title,
          status: TASK_STATUS_LABELS_TH[t.status],
          assignee:
            (t.assignees ?? [])
              .map((a) => a.profile?.display_name || a.profile?.username)
              .filter(Boolean)
              .join(', ') || '-',
        })),
        summary: {
          total: rows.length,
          done: rows.filter((t) => t.status === 'done').length,
          open: rows.filter((t) => !CLOSED_TASK_STATUSES.includes(t.status)).length,
        },
      };

      const mod = await import('./task-report-pdf');
      const blob = await mod.buildTaskReportPdf(reportData);
      mod.downloadBlob(blob, `รายงานงาน-${roomName}-${month}.pdf`);
      setOpen(false);
    } catch (err) {
      console.error('Task PDF export error:', err);
      toast({ type: 'error', title: t('report.failed') });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        {t('report.button')}
      </Button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title={t('report.title')} description={t('report.desc')} size="sm">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('report.month')}</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{tc('cancel')}</Button>
          <Button onClick={handleExport} disabled={exporting} icon={exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}>
            {t('report.download')}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
