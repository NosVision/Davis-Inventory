'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, FileText, Wand2, Upload, XCircle } from 'lucide-react';
import { Button, PageHeader, KpiRow, StatTile, StatusBadge, SectionHeading, usePromptDialog, toast } from '@/components/ui';

// ⑥ HR queue for personal-document requests: generate (50 ทวิ / salary cert), attach an
// accountant file, or reject. Open requests first.
interface DocReq {
  id: string;
  profile_id: string;
  name: string;
  doc_type: 'cert_50twi' | 'salary_cert' | 'slip_copy' | 'other';
  year: number | null;
  note: string | null;
  status: 'requested' | 'ready' | 'rejected';
  fulfillment: 'generated' | 'file' | null;
  created_at: string;
}

export default function HrDocumentRequestsPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'คำขอเอกสาร', subtitle: '50 ทวิ / หนังสือรับรอง / สำเนาสลิป — สร้างในระบบ หรือแนบไฟล์จากบัญชี', open: 'รอดำเนินการ', ready: 'เสร็จแล้ว', rejected: 'ปฏิเสธ', queue: 'คิวคำขอ', empty: 'ไม่มีคำขอค้าง', generate: 'สร้างในระบบ', attach: 'แนบไฟล์', reject: 'ปฏิเสธ', rejectReason: 'เหตุผลที่ปฏิเสธ', done: 'ทำรายการแล้ว', failed: 'ทำรายการไม่สำเร็จ', dl50: '50 ทวิ', dlSalary: 'หนังสือรับรองเงินเดือน', dlSlip: 'สำเนาสลิป', dlOther: 'อื่นๆ', cannotGen: 'เอกสารนี้สร้างอัตโนมัติไม่ได้ — แนบไฟล์แทน', history: 'ประวัติ' }
    : { title: 'Document requests', subtitle: '50 ทวิ / certificates / slip copies — generate or attach an accountant file', open: 'Pending', ready: 'Done', rejected: 'Rejected', queue: 'Queue', empty: 'No pending requests', generate: 'Generate', attach: 'Attach file', reject: 'Reject', rejectReason: 'Rejection reason', done: 'Done', failed: 'Action failed', dl50: '50 ทวิ', dlSalary: 'Salary certificate', dlSlip: 'Slip copy', dlOther: 'Other', cannotGen: 'This type cannot be auto-generated — attach a file', history: 'History' };

  const { prompt, dialog } = usePromptDialog();
  const [rows, setRows] = useState<DocReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/document-requests');
      const json = await res.json().catch(() => ({}));
      if (res.ok) setRows((json.data ?? []) as DocReq[]);
    } catch { /* keep */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async (r: DocReq) => {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/hr/document-requests/${r.id}/fulfill`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
      toast({ type: 'success', title: L.done });
      await load();
    } catch (e) {
      toast({ type: 'error', title: L.failed, message: e instanceof Error ? e.message : undefined });
    } finally { setBusy(null); }
  }, [L, load]);

  const reject = useCallback(async (r: DocReq) => {
    const note = await prompt({ title: L.rejectReason, required: true });
    if (!note) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/hr/document-requests/${r.id}/fulfill`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reject', note }),
      });
      if (!res.ok) throw new Error();
      toast({ type: 'success', title: L.done });
      await load();
    } catch { toast({ type: 'error', title: L.failed }); } finally { setBusy(null); }
  }, [prompt, L, load]);

  const pickFile = (id: string) => { uploadTarget.current = id; fileRef.current?.click(); };
  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const id = uploadTarget.current;
    e.target.value = '';
    if (!file || !id) return;
    setBusy(id);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/hr/document-requests/${id}/upload`, { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
      toast({ type: 'success', title: L.done });
      await load();
    } catch (err) {
      toast({ type: 'error', title: L.failed, message: err instanceof Error ? err.message : undefined });
    } finally { setBusy(null); }
  }, [L, load]);

  const typeLabel = (t: DocReq['doc_type']) => t === 'cert_50twi' ? L.dl50 : t === 'salary_cert' ? L.dlSalary : t === 'slip_copy' ? L.dlSlip : L.dlOther;
  const canGenerate = (t: DocReq['doc_type']) => t === 'cert_50twi' || t === 'salary_cert';
  const open = rows.filter((r) => r.status === 'requested');
  const decided = rows.filter((r) => r.status !== 'requested');

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageHeader title={L.title} subtitle={L.subtitle} />
      <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={onFile} />

      <KpiRow cols={3}>
        <StatTile label={L.open} value={open.length} icon={FileText} tone={open.length > 0 ? 'warn' : 'default'} />
        <StatTile label={L.ready} value={rows.filter((r) => r.status === 'ready').length} icon={FileText} tone="good" />
        <StatTile label={L.rejected} value={rows.filter((r) => r.status === 'rejected').length} icon={XCircle} />
      </KpiRow>

      {loading ? (
        <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          <SectionHeading title={L.queue} />
          {open.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400 dark:border-gray-700">{L.empty}</p>
          ) : (
            <ul className="space-y-2">
              {open.map((r) => (
                <li key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-800 dark:bg-amber-900/10">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{r.name} · {typeLabel(r.doc_type)}{r.year ? ` ${r.year}` : ''}</p>
                      {r.note && <p className="text-xs text-gray-500 dark:text-gray-400">{r.note}</p>}
                    </div>
                    <div className="flex gap-2">
                      {canGenerate(r.doc_type) && (
                        <Button size="sm" disabled={busy === r.id} isLoading={busy === r.id} icon={<Wand2 className="h-4 w-4" />} onClick={() => generate(r)}>{L.generate}</Button>
                      )}
                      <Button size="sm" variant="outline" disabled={busy === r.id} icon={<Upload className="h-4 w-4" />} onClick={() => pickFile(r.id)}>{L.attach}</Button>
                      <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => reject(r)}>{L.reject}</Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {decided.length > 0 && (
            <>
              <SectionHeading title={L.history} />
              <ul className="space-y-1">
                {decided.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800/50">
                    <span className="truncate text-gray-700 dark:text-gray-200">{r.name} · {typeLabel(r.doc_type)}{r.year ? ` ${r.year}` : ''}</span>
                    {r.status === 'ready' ? <StatusBadge tone="good" label={r.fulfillment === 'file' ? `${L.ready} (${L.attach})` : `${L.ready} (${L.generate})`} /> : <StatusBadge tone="critical" label={L.rejected} />}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {dialog}
    </div>
  );
}
