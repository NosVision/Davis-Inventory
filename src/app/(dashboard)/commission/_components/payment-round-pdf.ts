import { netDisplay } from '@/types/commission';
import { formatThaiDate } from '@/lib/utils/format';

export interface PaymentRoundForPdf {
  type: string;
  month: string;
  status: string;
  paid_at: string;
  notes: string | null;
  ae_profile?: {
    name?: string;
    nickname?: string | null;
    email?: string | null;
    bank_name?: string | null;
    bank_account_no?: string | null;
    bank_account_name?: string | null;
  } | null;
  staff_profile?: { display_name?: string | null; username?: string } | null;
  entries?: Array<Record<string, unknown>>;
}

/** The payment and history tabs use the same receipt, including bottle accounting. */
export async function buildPaymentRoundData(payment: PaymentRoundForPdf, rounded = false) {
  const mod = await import('./commission-pdf');
  const netOf = (n: number | null | undefined) => netDisplay(n, rounded);
  const isBottle = payment.type === 'bottle_commission';
  const ae = payment.ae_profile;
  const name = isBottle
    ? payment.staff_profile?.display_name || payment.staff_profile?.username || 'ไม่ระบุพนักงาน'
    : ae?.name || '-';
  const entries = [...(payment.entries || [])].sort((a, b) => String(a.bill_date).localeCompare(String(b.bill_date)));
  const rows = isBottle ? entries.map(e => mod.toBottleRow(e, netOf)) : entries.map(e => ({
    bill_date: String(e.bill_date || ''),
    receipt_no: (e.receipt_no as string | null) ?? null,
    table_no: (e.table_no as string | null) ?? null,
    subtotal: Number(e.subtotal_amount) || 0,
    commission_amount: Number(e.commission_amount) || 0,
    net_amount: netOf(e.net_amount as number),
    notes: (e.notes as string | null) ?? null,
  }));
  const totals = isBottle ? mod.sumBottleRows(rows) : rows.reduce((acc, r) => ({
    subtotal: acc.subtotal + r.subtotal,
    commission: acc.commission + r.commission_amount,
    net: acc.net + r.net_amount,
    bill_count: acc.bill_count + 1,
    bottles: 0,
  }), { subtotal: 0, commission: 0, net: 0, bill_count: 0, bottles: 0 });
  const [y, m] = payment.month.split('-').map(Number);
  const month = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  const paid = payment.status === 'cancelled' ? 0 : totals.net;
  const data: import('./commission-pdf').CommissionReportData = {
    store_name: 'สาขา',
    month_label: `${month} · จ่ายเมื่อ ${formatThaiDate(payment.paid_at)}${payment.status === 'cancelled' ? ' (ยกเลิกแล้ว)' : ''}`,
    generated_at_label: new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()),
    cover: [{ kind: isBottle ? 'bottle' : 'ae', ae_name: name, bill_count: totals.bill_count,
      net: totals.net, paid, outstanding: totals.net - paid, wht_label: null, note: payment.notes }],
    groups: [{
      kind: isBottle ? 'bottle' : 'ae', ae_name: name, ae_nickname: ae?.nickname ?? null,
      bank_label: !isBottle && ae?.bank_name
        ? `${ae.bank_name} ${ae.bank_account_no || ''}${ae.bank_account_name ? ` (${ae.bank_account_name})` : ''}`.trim() : null,
      email: !isBottle ? ae?.email ?? null : null,
      note: payment.notes, wht_label: null, rows, totals,
    }],
    grand: totals,
  };
  return data;
}

export async function exportPaymentRoundPdf(payment: PaymentRoundForPdf, rounded = false): Promise<string> {
  const mod = await import('./commission-pdf');
  const data = await buildPaymentRoundData(payment, rounded);
  const name = data.groups[0].ae_name.replace(/[\\/:*?"<>|]/g, '').trim() || 'ผู้รับ';
  const filename = `รอบจ่าย-${name}-${payment.month}.pdf`;
  mod.downloadBlob(await mod.buildCommissionPdf(data), filename);
  return filename;
}
