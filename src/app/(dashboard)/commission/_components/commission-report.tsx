'use client';

/**
 * Monthly commission report (owner ask 2026-08-06) — one row per AE for the selected month with
 * the numbers the accountant closes the books on: bills, ยอดบิล, ค่าคอม, หัก ณ ที่จ่าย, สุทธิ, and
 * how much of it has actually been transferred. The last column tracks who asked for their
 * ใบ 50 ทวิ (withholding-tax certificate) that month and whether it has been handed over, and
 * the หมายเหตุ beside it carries whatever the accountant needs to remember about that AE's month
 * (client ask 2026-09-04) — both live on the same commission_wht_certs row.
 *
 * Reads the same /api/commission/summary the payment tab uses, so the report can never disagree
 * with the payout screen; paid-vs-outstanding is derived from each bill's payment_id.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Badge, Button, Modal, ModalFooter, Textarea, toast } from '@/components/ui';
import { useAppStore } from '@/stores/app-store';
import { Loader2, FileText, Check, Plus, StickyNote, Lock, Mail, Pencil } from 'lucide-react';
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
  /** ขอใบ 50 ทวิ ประจำ, set on the AE (จัดการ AE tab) — pre-marks them every month. */
  wht_cert_standing?: boolean;
  /** อีเมลสำหรับส่งใบ 50 ทวิ — some AEs take the certificate by email instead of in person. */
  email: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
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
/** 'none' = the row exists only to carry a หมายเหตุ; the AE did not ask for a certificate. */
type WhtCertStatus = 'none' | 'requested' | 'issued';

interface WhtCert {
  ae_id: string;
  month: string;
  status: WhtCertStatus;
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

/**
 * The row read as a *certificate request*, or undefined when there is none.
 *
 * Status 'none' means the row exists only to hold the หมายเหตุ, so everything that asks "did this
 * AE ask for a ใบ 50 ทวิ?" has to look through it — otherwise typing a remark would silently mark
 * the AE as having asked.
 */
function certRequest(cert: WhtCert | undefined): WhtCert | undefined {
  return cert && cert.status !== 'none' ? cert : undefined;
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

  /** POST one (store, AE, month) row. Throws on failure so each caller toasts once. */
  const saveCert = useCallback(
    async (body: { ae_id: string; status?: WhtCertStatus; note?: string }): Promise<WhtCert> => {
      const res = await fetch('/api/commission/wht-certs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: currentStoreId, month, ...body }),
      });
      if (!res.ok) throw new Error('save failed');
      return (await res.json()) as WhtCert;
    },
    [currentStoreId, month],
  );

  /**
   * Cycle one AE's certificate: ไม่ขอ → ขอแล้ว → ออกให้แล้ว → ไม่ขอ.
   *
   * An AE with the standing flag is already "ขอแล้ว" every month without a row, so their first
   * click goes straight to ออกให้แล้ว and clearing returns them to the standing state rather than
   * to ไม่ขอ — the standing request is theirs to change on the จัดการ AE tab, not here.
   *
   * Clearing keeps the row whenever it carries a หมายเหตุ (the status drops to 'none' instead), so
   * unticking a certificate never throws away a remark someone typed.
   */
  async function cycleCert(aeId: string, standing = false) {
    if (!currentStoreId) {
      toast({ type: 'error', title: 'เลือกสาขาก่อน' });
      return;
    }
    const current = certs[aeId];
    const asked = certRequest(current);
    const next: WhtCertStatus = !asked
      ? standing
        ? 'issued'
        : 'requested'
      : asked.status === 'requested'
        ? 'issued'
        : 'none';
    setSavingCert(aeId);
    try {
      if (next === 'none' && !current?.note) {
        const params = new URLSearchParams({ store_id: currentStoreId, ae_id: aeId, month });
        const res = await fetch(`/api/commission/wht-certs?${params}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        setCerts((prev) => {
          const copy = { ...prev };
          delete copy[aeId];
          return copy;
        });
      } else {
        const saved = await saveCert({ ae_id: aeId, status: next });
        setCerts((prev) => ({ ...prev, [aeId]: { ...prev[aeId], ...saved } }));
      }
    } catch {
      toast({ type: 'error', title: 'บันทึกสถานะใบ 50 ทวิ ไม่สำเร็จ' });
    } finally {
      setSavingCert(null);
    }
  }

  /**
   * Save the หมายเหตุ without touching the status (the API keeps the current one when omitted).
   *
   * An AE with no row yet gets one at status 'none' — a remark is not a certificate request, and
   * this column has to work for the AEs who never ask for one.
   */
  async function saveNote() {
    if (!noteFor || !currentStoreId) return;
    setSavingNote(true);
    try {
      const saved = await saveCert({
        ae_id: noteFor.aeId,
        note: noteDraft,
      });
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

  // Anyone with a monthly request OR a standing one counts as having asked this month. Note-only
  // rows (status 'none') are not requests, so they must not inflate the count.
  const certCount = useMemo(
    () =>
      new Set([
        ...Object.values(certs).filter((c) => c.status !== 'none').map((c) => c.ae_id),
        ...ae.filter((a) => a.wht_cert_standing).map((a) => a.ae_id),
      ]).size,
    [certs, ae]
  );
  const noteCount = useMemo(() => Object.values(certs).filter((c) => c.note).length, [certs]);
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
                  <th className="px-3 py-2 text-left font-medium">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-gray-400">ไม่มีข้อมูลในเดือนนี้</td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const cert = certs[r.ae_id];
                    // A note-only row is not a request — see certRequest().
                    const asked = certRequest(cert);
                    return (
                      <tr key={r.ae_id} className="text-gray-700 dark:text-gray-200">
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900 dark:text-white">
                            {r.ae_name}{r.ae_nickname ? ` (${r.ae_nickname})` : ''}
                          </p>
                          {/* ชื่อ-สกุลเจ้าของบัญชี next to the number (client ask 2026-09-04): the
                              transfer is checked against the account holder, not the AE's nickname. */}
                          {r.bank_name && (
                            <p className="text-xs text-gray-400">
                              {r.bank_name} {r.bank_account_no || ''}
                              {r.bank_account_name ? ` · ${r.bank_account_name}` : ''}
                            </p>
                          )}
                          {r.email && (
                            <a
                              href={`mailto:${r.email}`}
                              className="mt-0.5 inline-flex items-center gap-1 text-xs text-indigo-500 hover:underline dark:text-indigo-400"
                              title="ส่งใบ 50 ทวิ ทางอีเมล"
                            >
                              <Mail className="h-3 w-3" /> {r.email}
                            </a>
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
                              onClick={() => cycleCert(r.ae_id, !!r.wht_cert_standing)}
                              disabled={savingCert === r.ae_id}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-full text-xs transition-colors disabled:cursor-wait disabled:opacity-50"
                              title={
                                r.wht_cert_standing && !asked
                                  ? 'AE คนนี้ตั้งไว้ว่าขอใบ 50 ทวิ ประจำทุกเดือน (แก้ได้ที่แท็บจัดการ AE) — กดเพื่อบันทึกว่าออกใบให้แล้ว'
                                  : certTooltip(asked)
                              }
                            >
                              {savingCert === r.ae_id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                              ) : !asked && r.wht_cert_standing ? (
                                // Standing request: pre-marked, no monthly tick needed.
                                <Badge variant="info" size="sm"><Lock className="h-3 w-3" /> ขอประจำ</Badge>
                              ) : !asked ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-gray-400 transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 dark:border-gray-600 dark:text-gray-500 dark:hover:border-indigo-500 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-300">
                                  <Plus className="h-3 w-3" /> ทำเครื่องหมาย
                                </span>
                              ) : asked.status === 'requested' ? (
                                <Badge variant="warning" size="sm"><FileText className="h-3 w-3" /> ขอแล้ว</Badge>
                              ) : (
                                <Badge variant="success" size="sm"><Check className="h-3 w-3" /> ออกให้แล้ว</Badge>
                              )}
                            </button>
                          </div>
                        </td>
                        {/* หมายเหตุ — its own column (client ask 2026-09-04). It used to be a hover
                            icon that only appeared once the AE had been ticked, so a remark was
                            invisible until you moused over it and impossible to leave on an AE who
                            never asks for a certificate. */}
                        <td className="px-3 py-2 align-top">
                          <button
                            type="button"
                            onClick={() => { setNoteFor({ aeId: r.ae_id, aeName: r.ae_name }); setNoteDraft(cert?.note ?? ''); }}
                            title={cert?.note ? 'กดเพื่อแก้ไขหมายเหตุ' : 'กดเพื่อเพิ่มหมายเหตุ'}
                            className="group/note flex w-full max-w-xs cursor-pointer items-start gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/60"
                          >
                            {cert?.note ? (
                              <>
                                <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
                                <span className="whitespace-pre-line break-words text-gray-600 dark:text-gray-300">{cert.note}</span>
                              </>
                            ) : (
                              <>
                                <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300 transition-colors group-hover/note:text-indigo-500 dark:text-gray-600" />
                                <span className="text-gray-300 dark:text-gray-600">เพิ่มหมายเหตุ</span>
                              </>
                            )}
                          </button>
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
                    <td className="px-3 py-2 text-left text-xs font-normal text-gray-500">
                      {noteCount > 0 ? `${noteCount} หมายเหตุ` : '—'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {rows.length > 0 && (
            <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
              คอลัมน์ <span className="font-medium">ใบ 50 ทวิ</span> กดได้ — วนสถานะ ไม่ขอ → ขอแล้ว → ออกให้แล้ว
              · คอลัมน์ <span className="font-medium">หมายเหตุ</span> กดเพื่อพิมพ์บันทึกของเดือนนี้ (ติดไปกับ PDF ด้วย)
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
          placeholder="เช่น ส่งทางอีเมลแล้ว / รอเอกสารจากบัญชี"
          hint="แสดงในตารางรายงาน และพิมพ์ลงในไฟล์ PDF ที่ดาวน์โหลด"
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
