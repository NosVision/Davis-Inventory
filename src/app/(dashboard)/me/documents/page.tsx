'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, FileText, Plus, Download, X } from 'lucide-react';
import { Button, Modal, ModalFooter, PageHeader, StatusBadge, toast } from '@/components/ui';
import { TileNotices } from '../_components/tile-notices';

// ⑥ พนักงานขอเอกสารส่วนตัว (50 ทวิ / หนังสือรับรองเงินเดือน / สำเนาสลิป / อื่นๆ) แล้วเปิด/ดาวน์โหลด
// เมื่อ HR ทำเสร็จ — ระบบ generate เอง หรือ HR แนบไฟล์จากสำนักงานบัญชี
interface DocReq {
  id: string;
  doc_type: 'cert_50twi' | 'salary_cert' | 'slip_copy' | 'other';
  year: number | null;
  note: string | null;
  status: 'requested' | 'ready' | 'rejected';
  fulfillment: 'generated' | 'file' | null;
  decision_note: string | null;
  created_at: string;
}

const baht = (satang: number) => (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function MyDocumentsPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'เอกสารของฉัน', subtitle: 'ขอ 50 ทวิ หนังสือรับรองเงินเดือน หรือสำเนาสลิปย้อนหลัง', request: 'ขอเอกสาร', type: 'ประเภทเอกสาร', year: 'ปี (พ.ศ./ค.ศ.)', note: 'หมายเหตุ', submit: 'ส่งคำขอ', cancel: 'ยกเลิก', empty: 'ยังไม่มีคำขอ', requested: 'รอดำเนินการ', ready: 'พร้อมแล้ว', rejected: 'ไม่อนุมัติ', view: 'เปิด/ดาวน์โหลด', requested_ok: 'ส่งคำขอแล้ว', failed: 'ทำรายการไม่สำเร็จ', dl50: '50 ทวิ (หนังสือรับรองหักภาษี ณ ที่จ่ายรายปี)', dlSalary: 'หนังสือรับรองเงินเดือน', dlSlip: 'สำเนาสลิปย้อนหลัง', dlOther: 'อื่นๆ (ระบุในหมายเหตุ)', close: 'ปิด', income: 'รายได้รวมทั้งปี', tax: 'ภาษีหัก ณ ที่จ่ายรวม', sso: 'ประกันสังคมรวม', months: 'จำนวนงวด', position: 'ตำแหน่ง', startDate: 'วันเริ่มงาน', salary: 'เงินเดือน', issued: 'ออกเอกสารวันที่' }
    : { title: 'My documents', subtitle: 'Request 50 ทวิ, a salary certificate, or a back-copy of a slip', request: 'Request document', type: 'Document type', year: 'Year', note: 'Note', submit: 'Submit', cancel: 'Cancel', empty: 'No requests yet', requested: 'Pending', ready: 'Ready', rejected: 'Rejected', view: 'Open / download', requested_ok: 'Request submitted', failed: 'Action failed', dl50: '50 ทวิ (annual withholding certificate)', dlSalary: 'Salary certificate', dlSlip: 'Back-copy of a slip', dlOther: 'Other (describe in note)', close: 'Close', income: 'Total annual income', tax: 'Total tax withheld', sso: 'Total SSO', months: 'Payslips', position: 'Position', startDate: 'Start date', salary: 'Salary', issued: 'Issued on' };

  const [rows, setRows] = useState<DocReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [docType, setDocType] = useState<DocReq['doc_type']>('cert_50twi');
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState<{ req: DocReq; data: Record<string, unknown> } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/document-requests');
      const json = await res.json().catch(() => ({}));
      if (res.ok) setRows((json.data ?? []) as DocReq[]);
    } catch { /* keep old */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/hr/ess/document-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_type: docType, year: docType === 'cert_50twi' ? Number(year) : undefined, note: note.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
      toast({ type: 'success', title: L.requested_ok });
      setFormOpen(false);
      setNote('');
      await load();
    } catch (e) {
      toast({ type: 'error', title: L.failed, message: e instanceof Error ? e.message : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  const openDoc = async (req: DocReq) => {
    try {
      const res = await fetch(`/api/hr/ess/document-requests/${req.id}/file`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
      if (json.data?.kind === 'file' && json.data.url) {
        window.open(json.data.url, '_blank');
        return;
      }
      setViewing({ req, data: (json.data?.generated ?? {}) as Record<string, unknown> });
    } catch (e) {
      toast({ type: 'error', title: L.failed, message: e instanceof Error ? e.message : undefined });
    }
  };

  const typeLabel = (t: DocReq['doc_type']) =>
    t === 'cert_50twi' ? L.dl50 : t === 'salary_cert' ? L.dlSalary : t === 'slip_copy' ? L.dlSlip : L.dlOther;
  const badge = (s: DocReq['status']) =>
    s === 'ready' ? <StatusBadge tone="good" label={L.ready} /> : s === 'rejected' ? <StatusBadge tone="critical" label={L.rejected} /> : <StatusBadge tone="warn" label={L.requested} />;

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <PageHeader title={L.title} subtitle={L.subtitle} actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>{L.request}</Button>} />

      <TileNotices tile="documents" />

      {loading ? (
        <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">{L.empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-5 w-5 shrink-0 text-indigo-400" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{typeLabel(r.doc_type)}{r.year ? ` · ${r.year}` : ''}</p>
                  {r.decision_note && r.status === 'rejected' && <p className="truncate text-xs text-red-500">{r.decision_note}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {badge(r.status)}
                {r.status === 'ready' && (
                  <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => openDoc(r)}>{L.view}</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* request form */}
      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title={L.request} size="sm">
        <div className="space-y-3">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">{L.type}
            <select value={docType} onChange={(e) => setDocType(e.target.value as DocReq['doc_type'])} className="control mt-1 w-full">
              <option value="cert_50twi">{L.dl50}</option>
              <option value="salary_cert">{L.dlSalary}</option>
              <option value="slip_copy">{L.dlSlip}</option>
              <option value="other">{L.dlOther}</option>
            </select>
          </label>
          {docType === 'cert_50twi' && (
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">{L.year}
              <input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="control mt-1 w-full" />
            </label>
          )}
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">{L.note}
            <input value={note} onChange={(e) => setNote(e.target.value)} className="control mt-1 w-full" />
          </label>
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setFormOpen(false)}>{L.cancel}</Button>
          <Button onClick={submit} isLoading={submitting}>{L.submit}</Button>
        </ModalFooter>
      </Modal>

      {/* generated-doc viewer */}
      {viewing && (
        <Modal isOpen onClose={() => setViewing(null)} title={typeLabel(viewing.req.doc_type)} size="sm">
          <div className="space-y-2 text-sm">
            {viewing.data.company != null && (
              <p className="border-b border-gray-200 pb-2 font-semibold dark:border-gray-700">{(viewing.data.company as { name?: string })?.name ?? ''}</p>
            )}
            {viewing.req.doc_type === 'cert_50twi' ? (
              <dl className="space-y-1">
                <Row label={L.year} value={String(viewing.data.year ?? '')} />
                <Row label={L.months} value={String(viewing.data.months_count ?? 0)} />
                <Row label={L.income} value={`฿${baht(Number(viewing.data.total_income_satang) || 0)}`} />
                <Row label={L.tax} value={`฿${baht(Number(viewing.data.total_tax_satang) || 0)}`} strong />
                <Row label={L.sso} value={`฿${baht(Number(viewing.data.total_sso_satang) || 0)}`} />
              </dl>
            ) : (
              <dl className="space-y-1">
                <Row label="" value={String(viewing.data.name ?? '')} strong />
                <Row label={L.position} value={String(viewing.data.position ?? '—')} />
                <Row label={L.startDate} value={String(viewing.data.start_date ?? '—')} />
                <Row label={L.salary} value={`฿${baht(Number(viewing.data.rate_satang) || 0)}`} strong />
                <Row label={L.issued} value={String(viewing.data.issued_date ?? '')} />
              </dl>
            )}
          </div>
          <ModalFooter>
            <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => window.print()}>{isTh ? 'พิมพ์' : 'Print'}</Button>
            <Button variant="ghost" onClick={() => setViewing(null)} icon={<X className="h-4 w-4" />}>{L.close}</Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={strong ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-800 dark:text-gray-100'}>{value}</span>
    </div>
  );
}
