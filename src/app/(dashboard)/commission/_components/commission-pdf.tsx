'use client';

/**
 * Commission Payout PDF — monthly summary used to settle AE commissions.
 *
 * Mirrors the spreadsheet layout the accountant has been keeping by hand:
 * one section per AE, rows per bill, with Total Bill / Subtotal /
 * Commission 10% / Net (after 3% withholding) columns plus signature
 * space for cashier and manager. The accountant asked for a receipt-#
 * column on top of the original spreadsheet, so it sits right after the
 * date.
 *
 * Total Bill is not stored — Thai SV (10%) + VAT (7%) compounded gives
 * subtotal × 1.177, which matches the math in the existing spreadsheet
 * the accountant emailed. We label it "(โดยประมาณ)" so anyone reading
 * the printout knows it's derived, not captured.
 *
 * Lazy-loaded via dynamic import in the parent so the ~600 KB react-pdf
 * bundle stays out of the main route chunk.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  pdf,
} from '@react-pdf/renderer';

// ────────────────────────────────────────────────────────────────────────────
// Font registration — same Noto Sans Thai TTFs already shipped under
// /public/fonts for the owner-review and HQ-receive PDFs.
// ────────────────────────────────────────────────────────────────────────────
function fontUrl(file: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/fonts/${file}`;
  }
  const base = process.env.NEXT_PUBLIC_APP_URL || '';
  return `${base}/fonts/${file}`;
}

Font.register({
  family: 'NotoSansThai',
  fonts: [
    { src: fontUrl('NotoSansThai-Regular.ttf'), fontWeight: 400 },
    { src: fontUrl('NotoSansThai-Bold.ttf'), fontWeight: 700 },
  ],
});

Font.registerHyphenationCallback((word) => [word]);

// SV 10% + VAT 7% compounded → 1.177. Matches the math in the
// accountant's existing Excel template; if a store doesn't charge SV
// or VAT this number will overstate Total Bill, but accountants treat
// this column as informational so we accept the simplification.
const GROSS_MULTIPLIER = 1.177;

// ────────────────────────────────────────────────────────────────────────────
// Styles — landscape A4. 9 columns + a per-AE header and totals row,
// so the Thai labels need ~80% of the width to breathe.
// ────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansThai',
    fontSize: 9,
    paddingTop: 28,
    paddingBottom: 40,
    paddingHorizontal: 28,
    color: '#111827',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: 2,
    borderBottomColor: '#0d9488',
    paddingBottom: 6,
    marginBottom: 10,
  },
  title: { fontSize: 14, fontWeight: 700, color: '#0f766e' },
  subTitle: { fontSize: 10, color: '#6b7280', marginTop: 2 },
  totals: { fontSize: 9, textAlign: 'right', color: '#374151' },
  totalsBig: { fontSize: 13, fontWeight: 700, color: '#0f766e' },

  aeBlock: { marginBottom: 10 },
  aeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ccfbf1',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderTopWidth: 0.5,
    borderColor: '#5eead4',
  },
  aeName: { fontSize: 11, fontWeight: 700, color: '#115e59' },
  aeBank: { fontSize: 9, color: '#0f766e' },

  tableHead: {
    flexDirection: 'row',
    backgroundColor: '#f0fdfa',
    fontWeight: 700,
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#99f6e4',
    color: '#134e4a',
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderBottomWidth: 0.3,
    borderColor: '#e5e7eb',
  },
  rowAlt: { backgroundColor: '#f9fafb' },
  totalRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderTopWidth: 0.5,
    borderColor: '#5eead4',
    backgroundColor: '#f0fdfa',
    fontWeight: 700,
  },

  // Column widths — landscape A4 printable area is ~789 px. 9 columns:
  // date / receipt# / table / total bill / subtotal / comm / net /
  // cashier sig / manager sig.
  cDate: { width: 56 },
  cReceipt: { width: 70 },
  cTable: { width: 36, textAlign: 'center' },
  cBill: { flex: 1, textAlign: 'right' },
  cSubtotal: { flex: 1, textAlign: 'right' },
  cCommission: { flex: 1, textAlign: 'right' },
  cNet: { flex: 1, textAlign: 'right', color: '#047857' },
  cCashier: { flex: 1.1, paddingHorizontal: 2, textAlign: 'center' },
  cManager: { flex: 1.1, paddingHorizontal: 2, textAlign: 'center' },

  signatureSlot: {
    borderBottomWidth: 0.5,
    borderColor: '#9ca3af',
    height: 14,
  },

  grandRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 3,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: '#0f766e',
    backgroundColor: '#ccfbf1',
    fontWeight: 700,
    marginTop: 8,
  },

  signatures: {
    marginTop: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  signatureCol: { width: '30%', alignItems: 'center' },
  signatureLine: {
    width: '100%',
    borderBottomWidth: 0.5,
    borderColor: '#9ca3af',
    height: 24,
  },
  signatureLabel: { marginTop: 2, fontSize: 9, color: '#374151' },

  footnote: {
    marginTop: 6,
    fontSize: 7.5,
    color: '#6b7280',
  },

  pageNum: {
    position: 'absolute',
    bottom: 18,
    right: 28,
    fontSize: 8,
    color: '#9ca3af',
  },
});

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────
export interface CommissionPdfRow {
  bill_date: string;       // YYYY-MM-DD
  receipt_no: string | null;
  table_no: string | null;
  subtotal: number;
  commission_amount: number;
  net_amount: number;
}

export interface CommissionPdfAEGroup {
  ae_name: string;
  ae_nickname: string | null;
  bank_label: string | null;        // e.g. "กสิกร 123-4-56789 (สมชาย ใจดี)"
  rows: CommissionPdfRow[];
  totals: {
    subtotal: number;
    commission: number;
    net: number;
    bill_count: number;
  };
}

export interface CommissionReportData {
  store_name: string;
  month_label: string;              // e.g. "เมษายน 2569"
  generated_at_label: string;       // e.g. "8 พ.ค. 2569 14:32"
  groups: CommissionPdfAEGroup[];
  grand: {
    subtotal: number;
    commission: number;
    net: number;
    bill_count: number;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Formatters
// ────────────────────────────────────────────────────────────────────────────
function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtShortDate(iso: string): string {
  // Thai d/m/yy — same compact format as the spreadsheet template.
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const yy = (d.getFullYear() + 543) % 100;
  return `${day}/${month}/${String(yy).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Document
// ────────────────────────────────────────────────────────────────────────────
function ReportDocument({ data }: { data: CommissionReportData }) {
  return (
    <Document title={`รายงานค่าคอมมิชชั่น ${data.month_label}`}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        {/* Header */}
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.title}>รายงานค่าคอมมิชชั่น (AE)</Text>
            <Text style={styles.subTitle}>
              {data.store_name} — เดือน {data.month_label}
            </Text>
            <Text style={styles.subTitle}>ออกรายงานเมื่อ {data.generated_at_label}</Text>
          </View>
          <View>
            <Text style={styles.totals}>ยอดจ่ายรวม</Text>
            <Text style={styles.totalsBig}>{fmtMoney(data.grand.net)} บาท</Text>
            <Text style={styles.totals}>
              AE {data.groups.length} คน · {data.grand.bill_count} บิล
            </Text>
          </View>
        </View>

        {/* Per-AE blocks */}
        {data.groups.map((g) => (
          <View key={g.ae_name} style={styles.aeBlock} wrap={true}>
            <View style={styles.aeHeader} wrap={false}>
              <Text style={styles.aeName}>
                {g.ae_name}
                {g.ae_nickname ? ` (${g.ae_nickname})` : ''}
              </Text>
              <Text style={styles.aeBank}>
                {g.bank_label || 'ไม่มีข้อมูลธนาคาร'}
              </Text>
            </View>

            {/* Column heads — render once per AE block. `fixed` only
                behaves well as a direct child of <Page>, so we don't
                use it inside a nested wrap block. */}
            <View style={styles.tableHead}>
              <Text style={styles.cDate}>วันที่</Text>
              <Text style={styles.cReceipt}>เลขใบเสร็จ</Text>
              <Text style={styles.cTable}>โต๊ะ</Text>
              <Text style={styles.cBill}>ยอดบิลรวม</Text>
              <Text style={styles.cSubtotal}>ก่อน SV/VAT</Text>
              <Text style={styles.cCommission}>ค่าคอม 10%</Text>
              <Text style={styles.cNet}>หัก 3% สุทธิ</Text>
              <Text style={styles.cCashier}>Cashier</Text>
              <Text style={styles.cManager}>Manager</Text>
            </View>

            {g.rows.map((r, idx) => (
              <View
                key={`${g.ae_name}-${idx}`}
                style={[styles.row, idx % 2 === 1 ? styles.rowAlt : {}]}
                wrap={false}
              >
                <Text style={styles.cDate}>{fmtShortDate(r.bill_date)}</Text>
                <Text style={styles.cReceipt}>{r.receipt_no || '-'}</Text>
                <Text style={styles.cTable}>{r.table_no || '-'}</Text>
                <Text style={styles.cBill}>
                  {fmtMoney(r.subtotal * GROSS_MULTIPLIER)}
                </Text>
                <Text style={styles.cSubtotal}>{fmtMoney(r.subtotal)}</Text>
                <Text style={styles.cCommission}>
                  {fmtMoney(r.commission_amount)}
                </Text>
                <Text style={styles.cNet}>{fmtMoney(r.net_amount)}</Text>
                <View style={styles.cCashier}>
                  <View style={styles.signatureSlot} />
                </View>
                <View style={styles.cManager}>
                  <View style={styles.signatureSlot} />
                </View>
              </View>
            ))}

            {/* Per-AE total */}
            <View style={styles.totalRow} wrap={false}>
              <Text style={styles.cDate}>รวม</Text>
              <Text style={styles.cReceipt}>
                {g.totals.bill_count} บิล
              </Text>
              <Text style={styles.cTable}> </Text>
              <Text style={styles.cBill}>
                {fmtMoney(g.totals.subtotal * GROSS_MULTIPLIER)}
              </Text>
              <Text style={styles.cSubtotal}>{fmtMoney(g.totals.subtotal)}</Text>
              <Text style={styles.cCommission}>
                {fmtMoney(g.totals.commission)}
              </Text>
              <Text style={styles.cNet}>{fmtMoney(g.totals.net)}</Text>
              <Text style={styles.cCashier}> </Text>
              <Text style={styles.cManager}> </Text>
            </View>
          </View>
        ))}

        {/* Grand total */}
        <View style={styles.grandRow} wrap={false}>
          <Text style={styles.cDate}>TOTAL</Text>
          <Text style={styles.cReceipt}>{data.grand.bill_count} บิล</Text>
          <Text style={styles.cTable}> </Text>
          <Text style={styles.cBill}>
            {fmtMoney(data.grand.subtotal * GROSS_MULTIPLIER)}
          </Text>
          <Text style={styles.cSubtotal}>{fmtMoney(data.grand.subtotal)}</Text>
          <Text style={styles.cCommission}>
            {fmtMoney(data.grand.commission)}
          </Text>
          <Text style={styles.cNet}>{fmtMoney(data.grand.net)}</Text>
          <Text style={styles.cCashier}> </Text>
          <Text style={styles.cManager}> </Text>
        </View>

        <Text style={styles.footnote}>
          * ยอดบิลรวมคำนวณจาก ก่อน SV/VAT × 1.177 (SV 10% + VAT 7%) เพื่ออ้างอิงเท่านั้น
        </Text>

        {/* Signatures */}
        <View style={styles.signatures} wrap={false}>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>ผู้จัดทำ</Text>
          </View>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>ผู้ตรวจสอบ</Text>
          </View>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>เจ้าของร้าน</Text>
          </View>
        </View>

        <Text
          style={styles.pageNum}
          render={({ pageNumber, totalPages }) =>
            `หน้า ${pageNumber} / ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────
export async function buildCommissionPdf(
  data: CommissionReportData,
): Promise<Blob> {
  return await pdf(<ReportDocument data={data} />).toBlob();
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
