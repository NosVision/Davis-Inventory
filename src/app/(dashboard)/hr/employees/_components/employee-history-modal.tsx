'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, History } from 'lucide-react';
import { Modal, EmptyState, toast } from '@/components/ui';

// Per-employee salary / position / status edit history (P1.5), read from the audit log via
// /api/hr/employees/[id]/history. Self-contained locale strings. Read-only timeline.
interface Change { field: string; from: string | null; to: string | null }
interface Event { id: string; action: string; created_at: string; reason: string | null; actor_name: string; changes: Change[] }

interface Props { employeeId: string | null; employeeName: string; onClose: () => void }

const baht = (v: string | null) => (v == null ? '—' : (Number(v) / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function EmployeeHistoryModal({ employeeId, employeeName, onClose }: Props) {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'ประวัติการปรับ', empty: 'ยังไม่มีประวัติการแก้ไข', loadFailed: 'โหลดไม่สำเร็จ', by: 'โดย', reason: 'เหตุผล', created: 'สร้างข้อมูล', fields: { rate_satang: 'เงินเดือน (บาท)', position_id: 'ตำแหน่ง', department_id: 'แผนก', pay_type: 'ประเภทค่าจ้าง', status: 'สถานะ', start_date: 'วันเริ่มงาน', sso_enrolled: 'ประกันสังคม' } as Record<string, string> }
    : { title: 'Change history', empty: 'No edit history yet', loadFailed: 'Load failed', by: 'by', reason: 'Reason', created: 'Created', fields: { rate_satang: 'Salary (THB)', position_id: 'Position', department_id: 'Department', pay_type: 'Pay type', status: 'Status', start_date: 'Start date', sso_enrolled: 'SSO' } as Record<string, string> };

  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/employees/${id}/history`);
      const json = await res.json();
      if (!res.ok) { toast({ type: 'error', title: json?.error || L.loadFailed }); setEvents([]); return; }
      setEvents((json.data ?? []) as Event[]);
    } catch { toast({ type: 'error', title: L.loadFailed }); }
    finally { setLoading(false); }
  }, [L.loadFailed]);

  useEffect(() => { if (employeeId) load(employeeId); }, [employeeId, load]);

  const fmtVal = (field: string, v: string | null) => (field === 'rate_satang' ? baht(v) : v ?? '—');
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(isTh ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(d);
  };

  return (
    <Modal isOpen={!!employeeId} onClose={onClose} title={`${L.title} · ${employeeName}`} size="lg">
      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : events.length === 0 ? (
        <EmptyState icon={History} title={L.empty} />
      ) : (
        <ol className="space-y-3">
          {events.map((e) => (
            <li key={e.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="tabular-nums">{fmtDate(e.created_at)}</span>
                <span>{e.action === 'create' ? L.created : `${L.by} ${e.actor_name}`}</span>
              </div>
              <ul className="space-y-1">
                {e.changes.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-[7rem] font-medium text-gray-700 dark:text-gray-200">{L.fields[c.field] ?? c.field}</span>
                    {e.action === 'create' ? (
                      <span className="tabular-nums text-gray-900 dark:text-white">{fmtVal(c.field, c.to)}</span>
                    ) : (
                      <span className="flex items-center gap-1.5 tabular-nums">
                        <span className="text-gray-400 line-through">{fmtVal(c.field, c.from)}</span>
                        <span className="text-gray-400">→</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtVal(c.field, c.to)}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {e.reason ? <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{L.reason}: {e.reason}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
