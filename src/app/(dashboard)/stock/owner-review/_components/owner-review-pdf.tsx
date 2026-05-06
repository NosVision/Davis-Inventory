'use client';

/**
 * Owner Review PDF — printable daily report for the owner / manager.
 *
 * Mirrors the on-screen table (10 cols) plus the per-staff monthly
 * violation strip. Same Noto Sans Thai font setup as the HQ receive
 * report so Thai text renders correctly inside any PDF viewer.
 *
 * Lazy-loaded by the page on first download to keep the ~600 KB
 * react-pdf bundle out of the main route chunk.
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
// Font registration (shared TTFs already shipped under /public/fonts).
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

// Thai has no spaces — disable react-pdf's hyphenation so it doesn't
// chop words mid-cluster.
Font.registerHyphenationCallback((word) => [word]);

// ────────────────────────────────────────────────────────────────────────────
// Styles — landscape A4 because the table has 10 columns + Thai labels.
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
    borderBottomColor: '#db2777',
    paddingBottom: 6,
    marginBottom: 10,
  },
  title: { fontSize: 14, fontWeight: 700, color: '#9d174d' },
  subTitle: { fontSize: 10, color: '#6b7280', marginTop: 2 },
  totals: { fontSize: 9, textAlign: 'right', color: '#374151' },
  totalsBig: { fontSize: 13, fontWeight: 700, color: '#9d174d' },

  quotaBlock: { marginBottom: 8 },
  quotaTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: '#7c2d12',
    backgroundColor: '#ffedd5',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  quotaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderBottomWidth: 0.5,
    borderColor: '#e5e7eb',
    fontSize: 9,
  },
  quotaWarn: { color: '#b45309' },
  quotaMax: { color: '#b91c1c' },

  tableHead: {
    flexDirection: 'row',
    backgroundColor: '#fce7f3',
    fontWeight: 700,
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#d1d5db',
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderBottomWidth: 0.3,
    borderColor: '#e5e7eb',
  },
  // 10 columns — widths sum to ~100% of the printable area
  cProduct: { flex: 2.4, paddingRight: 2 },
  cPos: { width: 36, textAlign: 'right' },
  cManual: { width: 38, textAlign: 'right' },
  cDiff: { width: 38, textAlign: 'right', fontWeight: 700 },
  cRecount: { width: 40, textAlign: 'right' },
  cConclusion: { flex: 2, paddingHorizontal: 2 },
  cResponsible: { flex: 1.3, paddingHorizontal: 2 },
  cPenalty: { width: 60, paddingHorizontal: 2 },
  cRemark: { flex: 1.6, paddingHorizontal: 2 },
  cHr: { width: 22, textAlign: 'center' },

  posDiff: { color: '#059669' },
  negDiff: { color: '#dc2626' },

  signatures: {
    marginTop: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  signatureCol: { width: '40%', alignItems: 'center' },
  signatureLine: {
    width: '100%',
    borderBottomWidth: 0.5,
    borderColor: '#9ca3af',
    height: 24,
  },
  signatureLabel: { marginTop: 2, fontSize: 9, color: '#374151' },
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
export interface OwnerReviewRow {
  product_name: string;
  product_code: string;
  pos_quantity: number | null;
  manual_quantity: number | null;
  difference: number | null;
  recount_quantity: number | null;
  conclusion: string | null;
  responsible_label: string | null;     // "พนักงาน A" or "Bar ทุกคน" etc.
  penalty_code: string | null;
  penalty_amount: number | null;
  remark: string | null;                // owner_notes
  escalated_to_hr: boolean;
}

export interface OwnerReviewQuotaRow {
  staff_name: string;
  violations: number;
  total_amount: number;
  level: 'normal' | 'warn' | 'max';
}

export interface OwnerReviewReportData {
  date_label: string;
  store_name: string;
  month_year: string;
  // Pre-formatted Thai label describing which row filter was applied
  // when this PDF was generated (e.g. "เฉพาะรายการที่ต้องชี้แจง").
  // Owners attach this PDF to LINE messages to staff, so it has to be
  // obvious from the doc itself which subset they're looking at.
  filter_label: string;
  totals: {
    items: number;
    discrepancies: number;
    pending_recount: number;
    escalated: number;
  };
  quota: OwnerReviewQuotaRow[];
  rows: OwnerReviewRow[];
}

// ────────────────────────────────────────────────────────────────────────────
// Number formatters (avoid pulling in the app's lib/utils to keep this
// module self-contained for lazy import).
// ────────────────────────────────────────────────────────────────────────────
function fmtQty(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  if (Math.abs(n) < 0.005) return '0';
  const r = Math.round(n);
  if (Math.abs(n - r) < 0.005) return String(r);
  return n.toFixed(2);
}
function fmtSigned(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  if (Math.abs(n) < 0.005) return '0';
  const sign = n > 0 ? '+' : '-';
  return sign + fmtQty(Math.abs(n));
}
function fmtNum(n: number): string {
  return new Intl.NumberFormat('th-TH').format(n);
}

// ────────────────────────────────────────────────────────────────────────────
// Document
// ────────────────────────────────────────────────────────────────────────────
function ReportDocument({ data }: { data: OwnerReviewReportData }) {
  return (
    <Document title={`รายงานเจ้าของร้าน ${data.date_label}`}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        {/* Header */}
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.title}>รายงานเจ้าของร้าน</Text>
            <Text style={styles.subTitle}>
              {data.store_name} — วันที่ {data.date_label}
            </Text>
            <Text style={[styles.subTitle, { fontWeight: 700, color: '#9d174d' }]}>
              ({data.filter_label} — {data.rows.length} รายการ)
            </Text>
          </View>
          <View>
            <Text style={styles.totals}>รายการทั้งหมด</Text>
            <Text style={styles.totalsBig}>{data.totals.items} รายการ</Text>
            <Text style={styles.totals}>
              ผลต่าง {data.totals.discrepancies} · ยังไม่นับซ้ำ{' '}
              {data.totals.pending_recount} · ส่ง HR {data.totals.escalated}
            </Text>
          </View>
        </View>

        {/* Monthly quota summary */}
        {data.quota.length > 0 && (
          <View style={styles.quotaBlock} wrap={false}>
            <Text style={styles.quotaTitle}>
              คะแนนความผิดเดือน {data.month_year}
            </Text>
            {data.quota.map((q) => (
              <View key={q.staff_name} style={styles.quotaRow}>
                <Text>{q.staff_name}</Text>
                <Text
                  style={
                    q.level === 'max'
                      ? styles.quotaMax
                      : q.level === 'warn'
                        ? styles.quotaWarn
                        : undefined
                  }
                >
                  {q.violations} ครั้ง · ค่าปรับสะสม {fmtNum(q.total_amount)} บาท
                  {q.level === 'max'
                    ? ' (ครบโควตา)'
                    : q.level === 'warn'
                      ? ' (ใกล้เกิน)'
                      : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Table head */}
        <View style={styles.tableHead} fixed>
          <Text style={styles.cProduct}>สินค้า</Text>
          <Text style={styles.cPos}>POS</Text>
          <Text style={styles.cManual}>นับได้</Text>
          <Text style={styles.cDiff}>ผลต่าง</Text>
          <Text style={styles.cRecount}>นับสอบ</Text>
          <Text style={styles.cConclusion}>สรุป</Text>
          <Text style={styles.cResponsible}>ผู้รับผิดชอบ</Text>
          <Text style={styles.cPenalty}>บทลงโทษ</Text>
          <Text style={styles.cRemark}>หมายเหตุ</Text>
          <Text style={styles.cHr}>HR</Text>
        </View>

        {/* Table body */}
        {data.rows.map((r, idx) => {
          const diff = r.difference || 0;
          const diffStyle =
            diff > 0 ? styles.posDiff : diff < 0 ? styles.negDiff : undefined;
          return (
            <View key={`${r.product_code}-${idx}`} style={styles.row} wrap={false}>
              <View style={styles.cProduct}>
                <Text>{r.product_name || r.product_code}</Text>
                <Text style={{ fontSize: 7, color: '#9ca3af' }}>
                  {r.product_code}
                </Text>
              </View>
              <Text style={styles.cPos}>{fmtQty(r.pos_quantity)}</Text>
              <Text style={styles.cManual}>{fmtQty(r.manual_quantity)}</Text>
              <Text style={[styles.cDiff, diffStyle || {}]}>
                {fmtSigned(r.difference)}
              </Text>
              <Text style={styles.cRecount}>{fmtQty(r.recount_quantity)}</Text>
              <Text style={styles.cConclusion}>{r.conclusion || ''}</Text>
              <Text style={styles.cResponsible}>{r.responsible_label || ''}</Text>
              <Text style={styles.cPenalty}>
                {r.penalty_code
                  ? `${r.penalty_code}${r.penalty_amount ? ` · ${fmtNum(r.penalty_amount)}฿` : ''}`
                  : ''}
              </Text>
              <Text style={styles.cRemark}>{r.remark || ''}</Text>
              <Text style={styles.cHr}>{r.escalated_to_hr ? '✓' : ''}</Text>
            </View>
          );
        })}

        {/* Signatures */}
        <View style={styles.signatures} wrap={false}>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>ผู้จัดการ / หัวหน้าบาร์</Text>
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
export async function buildOwnerReviewPdf(
  data: OwnerReviewReportData,
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
