'use client';

/**
 * HQ Receive Report — PDF generator with full Thai support.
 *
 * Uses @react-pdf/renderer (already in package.json). The Thai font is
 * a static subset of Noto Sans Thai (~45 KB regular + 45 KB bold) shipped
 * under /public/fonts so the PDF renders Thai correctly without relying
 * on a viewer's font fallback.
 *
 * Data shape mirrors the in-app HQ history view: one PDF per business
 * day, sessions grouped by from-store, each session showing the items
 * confirmed together + receiver name + timestamp.
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
// Font registration
// ────────────────────────────────────────────────────────────────────────────
// Resolve absolute URLs so the same code works from /api routes (server)
// and the browser. On the server we rely on NEXT_PUBLIC_APP_URL; in the
// browser window.location.origin is enough.
function fontUrl(file: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/fonts/${file}`;
  }
  const base = process.env.NEXT_PUBLIC_APP_URL || '';
  return `${base}/fonts/${file}`;
}

// Register once per module load — react-pdf de-dupes by family + key.
Font.register({
  family: 'NotoSansThai',
  fonts: [
    { src: fontUrl('NotoSansThai-Regular.ttf'), fontWeight: 400 },
    { src: fontUrl('NotoSansThai-Bold.ttf'), fontWeight: 700 },
  ],
});

// react-pdf can't word-wrap Thai (no spaces); disable hyphenation so it
// doesn't insert hyphens mid-word.
Font.registerHyphenationCallback((word) => [word]);

// ────────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansThai',
    fontSize: 10,
    paddingTop: 32,
    paddingBottom: 48,
    paddingHorizontal: 36,
    color: '#111827',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: 2,
    borderBottomColor: '#ea580c',
    paddingBottom: 8,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: '#9a3412',
  },
  subTitle: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  totals: {
    fontSize: 10,
    textAlign: 'right',
    color: '#374151',
  },
  totalsBig: {
    fontSize: 14,
    fontWeight: 700,
    color: '#9a3412',
  },
  storeBlock: {
    marginBottom: 14,
  },
  storeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    borderLeftWidth: 3,
    borderLeftColor: '#ea580c',
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginBottom: 4,
  },
  storeName: { fontSize: 12, fontWeight: 700, color: '#9a3412' },
  storeMeta: { fontSize: 9, color: '#6b7280' },
  sessionMeta: {
    fontSize: 9,
    color: '#6b7280',
    marginBottom: 2,
    paddingHorizontal: 6,
  },
  table: {
    marginTop: 2,
    marginBottom: 6,
    borderTopWidth: 0.5,
    borderColor: '#d1d5db',
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderColor: '#e5e7eb',
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  rowHead: {
    backgroundColor: '#f3f4f6',
    fontWeight: 700,
  },
  cellNum: { width: 22, textAlign: 'center', fontSize: 9 },
  cellProduct: { flex: 2.8, fontSize: 9, paddingRight: 4 },
  cellCustomer: { flex: 1.8, fontSize: 9, paddingRight: 4 },
  cellCode: { flex: 1.3, fontSize: 9, paddingRight: 4 },
  cellPct: { width: 56, textAlign: 'right', fontSize: 9, paddingRight: 4 },
  cellQty: { width: 50, textAlign: 'right', fontSize: 9 },
  // Footer block at the very end of the report
  signatures: {
    marginTop: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  signatureCol: {
    width: '40%',
    alignItems: 'center',
  },
  signatureLine: {
    width: '100%',
    borderBottomWidth: 0.5,
    borderColor: '#9ca3af',
    height: 28,
  },
  signatureLabel: {
    marginTop: 2,
    fontSize: 9,
    color: '#374151',
  },
  pageNum: {
    position: 'absolute',
    bottom: 24,
    right: 36,
    fontSize: 8,
    color: '#9ca3af',
  },
});

// ────────────────────────────────────────────────────────────────────────────
// Types — purposely small + serializable so the same shape can be passed
// from a server endpoint later without dragging in app types.
// ────────────────────────────────────────────────────────────────────────────
export interface ReportItem {
  product_name: string | null;
  customer_name: string | null;
  deposit_code: string | null;
  quantity: number | null;
  // Average remaining_percent across this deposit's bottles (or the
  // single bottle's value when quantity = 1). Null when no bottles row
  // exists for the deposit (legacy data before deposit_bottles).
  remaining_percent: number | null;
}

export interface ReportSession {
  session_id: string;
  received_at: string;          // ISO
  received_by_name: string | null;
  items: ReportItem[];
}

export interface ReportStore {
  from_store_name: string;
  sessions: ReportSession[];
}

export interface ReceiveReportData {
  date: string;                 // 'YYYY-MM-DD' Bangkok
  date_label: string;           // pre-formatted Thai date
  hq_name: string;
  total_items: number;
  total_sessions: number;
  receiver_names: string[];
  stores: ReportStore[];
}

// ────────────────────────────────────────────────────────────────────────────
// Document
// ────────────────────────────────────────────────────────────────────────────
function ReceiveReportDocument({ data }: { data: ReceiveReportData }) {
  return (
    <Document title={`รายงานการรับเข้า ${data.date_label}`}>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.title}>รายงานการรับเข้าคลังกลาง</Text>
            <Text style={styles.subTitle}>
              {data.hq_name} — วันที่ {data.date_label}
            </Text>
          </View>
          <View>
            <Text style={styles.totals}>รวมทั้งหมด</Text>
            <Text style={styles.totalsBig}>{data.total_items} รายการ</Text>
            <Text style={styles.totals}>
              {data.total_sessions} รอบรับ · {data.stores.length} สาขา
            </Text>
          </View>
        </View>

        {/* Per-store blocks */}
        {data.stores.map((store) => {
          const storeTotal = store.sessions.reduce(
            (sum, s) => sum + s.items.length,
            0,
          );
          return (
            <View key={store.from_store_name} style={styles.storeBlock} wrap>
              <View style={styles.storeHeader}>
                <Text style={styles.storeName}>{store.from_store_name}</Text>
                <Text style={styles.storeMeta}>{storeTotal} รายการ</Text>
              </View>

              {store.sessions.map((session, sIdx) => (
                // No wrap=false on the session block — a 40-item session
                // would overflow one page and react-pdf would render the
                // overflow on top of itself (the "garbled" jumble).
                // Per-row wrap=false below keeps individual rows atomic
                // while allowing the session to break across pages.
                <View key={session.session_id}>
                  <Text style={styles.sessionMeta} wrap={false}>
                    รอบที่ {sIdx + 1} — รับโดย{' '}
                    {session.received_by_name || '—'} เวลา{' '}
                    {new Date(session.received_at).toLocaleTimeString('th-TH', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Bangkok',
                    })}{' '}
                    น. ({session.items.length} รายการ)
                  </Text>

                  <View style={styles.table}>
                    <View style={[styles.row, styles.rowHead]} wrap={false}>
                      <Text style={styles.cellNum}>#</Text>
                      <Text style={styles.cellProduct}>สินค้า</Text>
                      <Text style={styles.cellCustomer}>ลูกค้า</Text>
                      <Text style={styles.cellCode}>รหัสฝาก</Text>
                      <Text style={styles.cellPct}>%คงเหลือ</Text>
                      <Text style={styles.cellQty}>จำนวน</Text>
                    </View>
                    {session.items.map((item, idx) => (
                      <View key={idx} style={styles.row} wrap={false}>
                        <Text style={styles.cellNum}>{idx + 1}</Text>
                        <Text style={styles.cellProduct}>
                          {item.product_name || '—'}
                        </Text>
                        <Text style={styles.cellCustomer}>
                          {item.customer_name || '—'}
                        </Text>
                        <Text style={styles.cellCode}>
                          {item.deposit_code || '—'}
                        </Text>
                        <Text style={styles.cellPct}>
                          {item.remaining_percent !== null && item.remaining_percent !== undefined
                            ? `${item.remaining_percent}%`
                            : '—'}
                        </Text>
                        <Text style={styles.cellQty}>
                          {item.quantity ?? '—'}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          );
        })}

        {/* Signatures (only on last page) */}
        <View style={styles.signatures} wrap={false}>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              ผู้รับเข้า (HQ){' '}
              {data.receiver_names.length > 0
                ? `: ${data.receiver_names.join(', ')}`
                : ''}
            </Text>
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
// Public entrypoint — builds a Blob the caller can trigger as a download.
// ────────────────────────────────────────────────────────────────────────────
export async function buildReceiveReportPdf(
  data: ReceiveReportData,
): Promise<Blob> {
  const blob = await pdf(<ReceiveReportDocument data={data} />).toBlob();
  return blob;
}

// Helper: trigger a browser download for a Blob.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick — Safari needs the element click to complete first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
