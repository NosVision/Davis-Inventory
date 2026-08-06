'use client';

/**
 * Monthly commission report (owner ask 2026-08-06) — one row per AE for the selected month with
 * the numbers the accountant closes the books on: bills, ยอดบิล, ค่าคอม, หัก ณ ที่จ่าย, สุทธิ, and
 * how much of it has actually been transferred. The last column tracks who asked for their
 * ใบ 50 ทวิ (withholding-tax certificate) that month and whether it has been handed over.
 *
 * Reads the same /api/commission/summary the payment tab uses, so the report can never disagree
 * with the payout screen; paid-vs-outstanding is derived from each bill's payment_id.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Badge, Button, Modal, ModalFooter, Textarea, toast } from '@/components/ui';
import { useAppStore } from '@/stores/app-store';
import { Loader2, FileText, Check, Plus, StickyNote } from 'lucide-react';
import { netDisplay } from '@/types/commission';
import { CommissionExportButton } from './commission-export-button';

interface SummaryEntry {
  id: string;
  payment_id: string | null;
  net_amount: number;
}
interface AESummary {
  ae_id: string;
  ae_name: string;
  ae_nickname: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  entry_count: number;
  total_subtotal: number;
  total_commission: number;
  total_tax: number;
  total_net: number;
  entries: SummaryEntry[];
}
interface BottleSummary {
  staff_id: string;
  staff_name: string;
  entry_count: number;
  total_bottles: number;
  total_net: number;
}
interface CertActor {
  display_name: string | null;
  username: string | null;
}
interface WhtCert {
  ae_id: string;
  month: string;
  status: 'requested' | 'issued';
  note: string | null;
  requested_at: string | null;
  issued_at: string | null;
  requester: CertActor | null;
  issuer: CertActor | null;
}

interface CommissionReportProps {
  month: string;
  refreshKey?: number;
  /** display-only whole-baht view (entries are stored exact) */
  rounded?: boolean;
}

function formatCurrency(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function actorLabel(a: CertActor | null): string {
  return a?.display_name || a?.username || 'ไม่ทราบ';
}

function stampLabel(at: string | null): string {
  if (!at) return '';
  return new Date(at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Hover text spelling out who ticked what and when — the DB has always stored it, nothing showed it. */
function certTooltip(cert: WhtCert | undefined): string {
  if (!cert) return 'กดเพื่อทำเครื่องหมายว่า AE คนนี้ขอใบ 50 ทวิ';
  const lines = [`ขอโดย ${actorLabel(cert.requester)} · ${stampLabel(cert.requested_at)}`];
  if (cert.status === 'issued') {
    lines.push(`ออกให้โดย ${actorLabel(cert.issuer)} · ${stampLabel(cert.issued_at)}`);
  }
  if (cert.note) lines.push(`หมายเหตุ: ${cert.note}`);
  lines.push(cert.status === 'requested' ? 'กดเพื่อเปลี่ยนเป็น "ออกให้แล้ว"' : 'กดเพื่อล้างเป็น "ไม่ขอ"');
  return lines.join('\n');
}

export function CommissionReport({ month, refreshKey, rounded = false }: CommissionReportProps) {
  const { currentStoreId } = useAppStore();
  const [ae, setAe] = useState<AESummary[]>([]);
  const [bottle, setBottle] = useState<BottleSummary[]>([]);
  const [certs, setCerts] = useState<Record<string, WhtCert>>({});
  const [loading, setLoading] = useState(false);
  const [savingCert, setSavingCert] = useState<string | null>(null);
  // หมายเหตุ editor — the API has always accepted `note`; there was no way to type one.
  const [noteFor, setNoteFor] = useState<{ aeId: string; aeName: string } | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ month });
      if (currentStoreId) params.set('store_id', currentStoreId);
      const [sumRes, certRes] = await Promise.all([
        fetch(`/api/commission/summary?${params}`),
        fetch(`/api/commission/wht-certs?${params}`),
      ]);
      if (sumRes.ok) {
        const json = await sumRes.json();
        setAe((json.ae_summary as AESummary[]) || []);
        setBottle((json.bottle_summary as BottleSummary[]) || []);
      } else {
        setAe([]);
        setBottle([]);
      }
      if (certRes.ok) {
        const rows = (await certRes.json()) as WhtCert[];
        setCerts(Object.fromEntries(rows.map((r) => [r.ae_id, r])));
      }
    } finally {
      setLoading(false);
    }
  }, [month, currentStoreId, refreshKey]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /** Cycle one AE's certificate through: ไม่ขอ → ขอแล้ว → ออกให้แล้ว → ไม่ขอ. */
  async function cycleCert(aeId: string) {
    if (!currentStoreId) {
      toast({ type: 'error', title: 'เลือกสาขาก่อน' });
      return;
    }
    const current = certs[aeId];
    const next = !current ? 'requested' : current.status === 'requested' ? 'issued' : null;
    setSavingCert(aeId);
    try {
      if (next === null) {
        const params = new URLSearchParams({ store_id: currentStoreId, ae_id: aeId, month });
        const res = await fetch(`/api/commission/wht-certs?${params}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        setCerts((prev) => {
          const copy = { ...prev };
          delete copy[aeId];
          return copy;
        });
      } else {
        const res = await fetch('/api/commission/wht-certs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store_id: currentStoreId, ae_id: aeId, month, status: next }),
        });
        if (!res.ok) throw new Error();
        const saved = (await res.json()) as WhtCert;
        setCerts((prev) => ({ ...prev, [aeId]: saved }));
      }
    } catch {
      toast({ type: 'error', title: 'บันทึกสถานะใบ 50 ทวิ ไม่สำเร็จ' });
    } finally {
      setSavingCert(null);
    }
  }

  /** Save the หมายเหตุ without touching the status (the API keeps the current one when omitted). */
  async function saveNote() {
    if (!noteFor || !currentStoreId) return;
    setSavingNote(true);
    try {
      const res = await fetch('/api/commission/wht-certs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: currentStoreId, ae_id: noteFor.aeId, month, note: noteDraft }),
      });
      if (!res.ok) throw new Error();
      const saved = (await res.json()) as WhtCert;
      // The write does not embed the actor rows, so keep the ones already on screen.
      setCerts((prev) => ({
        ...prev,
        [noteFor.aeId]: { ...prev[noteFor.aeId], ...saved },
      }));
      setNoteFor(null);
    } catch {
      toast({ type: 'error', title: 'บันทึกหมายเหตุไม่สำเร็จ' });
    } finally {
      setSavingNote(false);
    }
  }

  const rows = useMemo(
    () =>
      ae.map((a) => {
        const paid = a.entries.filter((e) => e.payment_id).reduce((s, e) => s + netDisplay(e.net_amount, rounded), 0);
        const net = a.entries.reduce((s, e) => s + netDisplay(e.net_amount, rounded), 0);
        return { ...a, net, paid, outstanding: net - paid };
      }),
    [ae, rounded],
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          bills: acc.bills + r.entry_count,
          subtotal: acc.subtotal + r.total_subtotal,
          commission: acc.commission + r.total_commission,
          tax: acc.tax + r.total_tax,
          net: acc.net + r.net,
          paid: acc.paid + r.paid,
          outstanding: acc.outstanding + r.outstanding,
        }),
        { bills: 0, subtotal: 0, commission: 0, tax: 0, net: 0, paid: 0, outstanding: 0 },
      ),
    [rows],
  );

  const certCount = useMemo(() => Object.keys(certs).length, [certs]);
  const bottleTotal = useMemo(() => bottle.reduce((s, b) => s + b.total_net, 0), [bottle]);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg bg-gray-100 px-2.5 py-1 dark:bg-gray-800 dark:text-gray-300">
            AE {rows.length} คน · {totals.bills} บิล
          </span>
          <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
            จ่ายแล้ว {formatCurrency(totals.paid)}
          </span>
          <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            ค้างจ่าย {formatCurrency(totals.outstanding)}
          </span>
          <span className="rounded-lg bg-indigo-50 px-2.5 py-1 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300">
            ขอใบ 50 ทวิ {certCount} คน
          </span>
        </div>
        <CommissionExportButton month={month} rounded={rounded} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">AE</th>
                  <th className="px-3 py-2 text-right font-medium">บิล</th>
                  <th className="px-3 py-2 text-right font-medium">ยอดบิล</th>
                  <th className="px-3 py-2 text-right font-medium">ค่าคอม</th>
                  <th className="px-3 py-2 text-right font-medium">หัก ณ ที่จ่าย</th>
                  <th className="px-3 py-2 text-right font-medium">สุทธิ</th>
                  <th className="px-3 py-2 text-right font-medium">ค้างจ่าย</th>
                  <th className="px-3 py-2 text-center font-medium">ใบ 50 ทวิ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-gray-400">ไม่มีข้อมูลในเดือนนี้</td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const cert = certs[r.ae_id];
                    return (
                      <tr key={r.ae_id} className="text-gray-700 dark:text-gray-200">
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900 dark:text-white">
                            {r.ae_name}{r.ae_nickname ? ` (${r.ae_nickname})` : ''}
                          </p>
                          {r.bank_name && (
                            <p className="text-xs text-gray-400">{r.bank_name} {r.bank_account_no || ''}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.entry_count}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.total_subtotal)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.total_commission)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-500">−{formatCurrency(r.total_tax)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCurrency(r.net)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${r.outstanding > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-300'}`}>
                          {r.outstanding > 0 ? formatCurrency(r.outstanding) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {/* One button cycling ไม่ขอ → ขอแล้ว → ออกให้แล้ว: the accountant ticks
                              as the AE asks, then again when the certificate is handed over. The
                              empty state used to be flat grey text that read as "no data" — it now
                              looks like the control it is. */}
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => cycleCert(r.ae_id)}
                              disabled={savingCert === r.ae_id}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-full text-xs transition-colors disabled:cursor-wait disabled:opacity-50"
                              title={certTooltip(cert)}
                            >
                              {savingCert === r.ae_id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                              ) : !cert ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-gray-400 transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 dark:border-gray-600 dark:text-gray-500 dark:hover:border-indigo-500 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-300">
                                  <Plus className="h-3 w-3" /> ทำเครื่องหมาย
                                </span>
                              ) : cert.status === 'requested' ? (
                                <Badge variant="warning" size="sm"><FileText className="h-3 w-3" /> ขอแล้ว</Badge>
                              ) : (
                                <Badge variant="success" size="sm"><Check className="h-3 w-3" /> ออกให้แล้ว</Badge>
                              )}
                            </button>
                            {cert && (
                              <button
                                type="button"
                                onClick={() => { setNoteFor({ aeId: r.ae_id, aeName: r.ae_name }); setNoteDraft(cert.note ?? ''); }}
                                title={cert.note ? `หมายเหตุ: ${cert.note}` : 'เพิ่มหมายเหตุ'}
                                className={`cursor-pointer rounded p-0.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${cert.note ? 'text-indigo-500' : 'text-gray-300 dark:text-gray-600'}`}
                              >
                                <StickyNote className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold dark:border-gray-600 dark:bg-gray-800/50">
                  <tr className="text-gray-900 dark:text-white">
                    <td className="px-3 py-2">รวม</td>
                    <td className="px-3 py-2 text-right tabular-nums">{totals.bills}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.subtotal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.commission)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-500">−{formatCurrency(totals.tax)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.net)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">
                      {totals.outstanding > 0 ? formatCurrency(totals.outstanding) : '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-xs font-normal text-gray-500">{certCount} คน</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {rows.length > 0 && (
            <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
              คอลัมน์ <span className="font-medium">ใบ 50 ทวิ</span> กดได้ — วนสถานะ ไม่ขอ → ขอแล้ว → ออกให้แล้ว
              และกดไอคอนโน้ตเพื่อใส่หมายเหตุ
            </p>
          )}
        </CardContent>
      </Card>

      {/* Bottle commission is paid to staff, not AEs — summarised separately so the AE table
          above stays the one the withholding certificates map onto. */}
      {bottle.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
              ค่าคอมขวด (พนักงาน) · รวม {formatCurrency(bottleTotal)}
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {bottle.map((b) => (
                  <tr key={b.staff_id} className="text-gray-700 dark:text-gray-200">
                    <td className="px-3 py-2">{b.staff_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-gray-400">{b.total_bottles} ขวด · {b.entry_count} รายการ</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCurrency(b.total_net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Modal
        isOpen={!!noteFor}
        onClose={() => setNoteFor(null)}
        title="หมายเหตุใบ 50 ทวิ"
        description={noteFor ? `${noteFor.aeName} · เดือน ${month}` : undefined}
      >
        <Textarea
          label="หมายเหตุ"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          rows={3}
          placeholder="เช่น ส่งทางไลน์แล้ว / รอเอกสารจากบัญชี"
        />
        <ModalFooter>
          <Button variant="ghost" onClick={() => setNoteFor(null)} disabled={savingNote}>ยกเลิก</Button>
          <Button variant="primary" onClick={saveNote} disabled={savingNote}>
            {savingNote && <Loader2 className="h-4 w-4 animate-spin" />}
            บันทึก
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
