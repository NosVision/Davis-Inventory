'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, FileText, Plus, Download, X } from 'lucide-react';
import { Button, Modal, ModalFooter, PageHeader, StatusBadge, toast } from '@/components/ui';
import { useEssText } from '@/lib/i18n/ess-locale';
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
  const tx = useEssText();
  const L = {
    title: tx('เอกสารของฉัน', 'My documents', 'ကျွန်ုပ်၏ စာရွက်စာတမ်း', 'ເອກະສານຂອງຂ້ອຍ'),
    subtitle: tx('ขอ 50 ทวิ หนังสือรับรองเงินเดือน หรือสำเนาสลิปย้อนหลัง', 'Request 50 ทวิ, a salary certificate, or a back-copy of a slip', '50 ทวิ၊ လစာထောက်ခံစာ သို့မဟုတ် စလစ်မိတ္တူ တောင်းရန်', 'ຂໍ 50 ทวิ, ໃບຢັ້ງຢືນເງິນເດືອນ ຫຼື ສຳເນົາສະລິບຍ້ອນຫຼັງ'),
    request: tx('ขอเอกสาร', 'Request document', 'စာရွက်စာတမ်းတောင်းရန်', 'ຂໍເອກະສານ'),
    type: tx('ประเภทเอกสาร', 'Document type', 'စာရွက်စာတမ်းအမျိုးအစား', 'ປະເພດເອກະສານ'),
    year: tx('ปี (พ.ศ./ค.ศ.)', 'Year', 'ခုနှစ်', 'ປີ'),
    note: tx('หมายเหตุ', 'Note', 'မှတ်ချက်', 'ໝາຍເຫດ'),
    submit: tx('ส่งคำขอ', 'Submit', 'တောင်းဆိုချက်ပို့ရန်', 'ສົ່ງຄຳຂໍ'),
    cancel: tx('ยกเลิก', 'Cancel', 'ပယ်ဖျက်', 'ຍົກເລີກ'),
    empty: tx('ยังไม่มีคำขอ', 'No requests yet', 'တောင်းဆိုချက် မရှိသေးပါ', 'ຍັງບໍ່ມີຄຳຂໍ'),
    requested: tx('รอดำเนินการ', 'Pending', 'စောင့်ဆိုင်းဆဲ', 'ລໍດຳເນີນການ'),
    ready: tx('พร้อมแล้ว', 'Ready', 'ရပြီ', 'ພ້ອມແລ້ວ'),
    rejected: tx('ไม่อนุมัติ', 'Rejected', 'ငြင်းပယ်', 'ບໍ່ອະນຸມັດ'),
    view: tx('เปิด/ดาวน์โหลด', 'Open / download', 'ဖွင့်/ဒေါင်းလုဒ်', 'ເປີດ/ດາວໂຫຼດ'),
    requested_ok: tx('ส่งคำขอแล้ว', 'Request submitted', 'တောင်းဆိုချက်ပို့ပြီးပါပြီ', 'ສົ່ງຄຳຂໍແລ້ວ'),
    failed: tx('ทำรายการไม่สำเร็จ', 'Action failed', 'လုပ်ဆောင်၍မရပါ', 'ເຮັດລາຍການບໍ່ສຳເລັດ'),
    dl50: tx('50 ทวิ (หนังสือรับรองหักภาษี ณ ที่จ่ายรายปี)', '50 ทวิ (annual withholding certificate)', '50 ทวิ (နှစ်စဉ်အခွန်ဖြတ်တောက်မှုထောက်ခံစာ)', '50 ทวิ (ໃບຢັ້ງຢືນຫັກພາສີປະຈຳປີ)'),
    dlSalary: tx('หนังสือรับรองเงินเดือน', 'Salary certificate', 'လစာထောက်ခံစာ', 'ໃບຢັ້ງຢືນເງິນເດືອນ'),
    dlSlip: tx('สำเนาสลิปย้อนหลัง', 'Back-copy of a slip', 'လစာစလစ်မိတ္တူ', 'ສຳເນົາສະລິບຍ້ອນຫຼັງ'),
    dlOther: tx('อื่นๆ (ระบุในหมายเหตุ)', 'Other (describe in note)', 'အခြား (မှတ်ချက်တွင်ဖော်ပြပါ)', 'ອື່ນໆ (ລະບຸໃນໝາຍເຫດ)'),
    close: tx('ปิด', 'Close', 'ပိတ်ရန်', 'ປິດ'),
    income: tx('รายได้รวมทั้งปี', 'Total annual income', 'တစ်နှစ်စုစုပေါင်းဝင်ငွေ', 'ລາຍໄດ້ລວມທັງປີ'),
    tax: tx('ภาษีหัก ณ ที่จ่ายรวม', 'Total tax withheld', 'ဖြတ်တောက်အခွန်စုစုပေါင်း', 'ພາສີຫັກລວມ'),
    sso: tx('ประกันสังคมรวม', 'Total SSO', 'လူမှုဖူလုံရေးစုစုပေါင်း', 'ປະກັນສັງຄົມລວມ'),
    months: tx('จำนวนงวด', 'Payslips', 'စလစ်အရေအတွက်', 'ຈຳນວນງວດ'),
    position: tx('ตำแหน่ง', 'Position', 'ရာထူး', 'ຕຳແໜ່ງ'),
    startDate: tx('วันเริ่มงาน', 'Start date', 'အလုပ်စတင်သည့်နေ့', 'ວັນເລີ່ມວຽກ'),
    salary: tx('เงินเดือน', 'Salary', 'လစာ', 'ເງິນເດືອນ'),
    issued: tx('ออกเอกสารวันที่', 'Issued on', 'ထုတ်ပေးသည့်နေ့', 'ອອກເອກະສານວັນທີ'),
  };

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
            <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => window.print()}>{tx('พิมพ์', 'Print', 'ပရင့်ထုတ်ရန်', 'ພິມ')}</Button>
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
