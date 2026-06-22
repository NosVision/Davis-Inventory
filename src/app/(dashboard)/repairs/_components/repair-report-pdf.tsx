'use client';

/**
 * Monthly repair + maintenance summary PDF for the owner.
 * Mirrors the Thai-font setup used by the commission/owner-review PDFs
 * (Noto Sans Thai TTFs under /public/fonts). Lazy-loaded via dynamic
 * import so the ~600 KB react-pdf bundle stays out of the route chunk.
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
    borderBottomColor: '#ea580c',
    paddingBottom: 6,
    marginBottom: 10,
  },
  title: { fontSize: 14, fontWeight: 700, color: '#c2410c' },
  subTitle: { fontSize: 10, color: '#6b7280', marginTop: 2 },

  cards: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  card: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
    borderRadius: 4,
    padding: 6,
  },
  cardLabel: { fontSize: 8, color: '#6b7280' },
  cardValue: { fontSize: 13, fontWeight: 700, color: '#111827', marginTop: 2 },

  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: '#c2410c',
    marginTop: 8,
    marginBottom: 4,
  },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: '#fff7ed',
    fontWeight: 700,
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#fed7aa',
    color: '#7c2d12',
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderBottomWidth: 0.3,
    borderColor: '#e5e7eb',
  },
  rowAlt: { backgroundColor: '#f9fafb' },

  cDate: { width: 56 },
  cTitle: { flex: 1 },
  cStatus: { width: 90 },
  cResolution: { width: 70 },
  cCost: { width: 70, textAlign: 'right' },

  empty: { fontSize: 9, color: '#9ca3af', paddingVertical: 8, textAlign: 'center' },

  pageNum: {
    position: 'absolute',
    bottom: 18,
    right: 28,
    fontSize: 8,
    color: '#9ca3af',
  },
});

export interface RepairReportRow {
  date: string; // YYYY-MM-DD
  title: string;
  status: string;
  resolution: string;
  cost: number | null;
}

export interface MaintenanceReportRow {
  date: string;
  title: string;
  status: string;
}

export interface RepairReportData {
  store_name: string;
  month_label: string;
  generated_at_label: string;
  repairs: RepairReportRow[];
  maintenance: MaintenanceReportRow[];
  summary: {
    total: number;
    completed: number;
    open: number;
    needsPurchase: number;
    totalCost: number;
    maintenanceTotal: number;
    maintenanceDone: number;
  };
}

function fmtMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '-';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtShortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const yy = (d.getFullYear() + 543) % 100;
  return `${d.getDate()}/${d.getMonth() + 1}/${String(yy).padStart(2, '0')}`;
}

function ReportDocument({ data }: { data: RepairReportData }) {
  return (
    <Document title={`รายงานงานซ่อม ${data.month_label}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.title}>รายงานงานซ่อม & งานประจำ</Text>
            <Text style={styles.subTitle}>
              {data.store_name} — เดือน {data.month_label}
            </Text>
            <Text style={styles.subTitle}>ออกรายงานเมื่อ {data.generated_at_label}</Text>
          </View>
        </View>

        <View style={styles.cards}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>งานซ่อมทั้งหมด</Text>
            <Text style={styles.cardValue}>{data.summary.total}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>เสร็จแล้ว</Text>
            <Text style={styles.cardValue}>{data.summary.completed}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>ค้าง</Text>
            <Text style={styles.cardValue}>{data.summary.open}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>ค่าใช้จ่ายรวม</Text>
            <Text style={styles.cardValue}>{fmtMoney(data.summary.totalCost)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>งานซ่อม</Text>
        <View style={styles.tableHead}>
          <Text style={styles.cDate}>วันที่</Text>
          <Text style={styles.cTitle}>รายการ</Text>
          <Text style={styles.cStatus}>สถานะ</Text>
          <Text style={styles.cResolution}>ผลประเมิน</Text>
          <Text style={styles.cCost}>ค่าใช้จ่าย</Text>
        </View>
        {data.repairs.length === 0 ? (
          <Text style={styles.empty}>ไม่มีงานซ่อมในเดือนนี้</Text>
        ) : (
          data.repairs.map((r, idx) => (
            <View key={idx} style={[styles.row, idx % 2 === 1 ? styles.rowAlt : {}]} wrap={false}>
              <Text style={styles.cDate}>{fmtShortDate(r.date)}</Text>
              <Text style={styles.cTitle}>{r.title}</Text>
              <Text style={styles.cStatus}>{r.status}</Text>
              <Text style={styles.cResolution}>{r.resolution}</Text>
              <Text style={styles.cCost}>{fmtMoney(r.cost)}</Text>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>
          งานประจำ ({data.summary.maintenanceDone}/{data.summary.maintenanceTotal} เสร็จ)
        </Text>
        <View style={styles.tableHead}>
          <Text style={styles.cDate}>กำหนด</Text>
          <Text style={styles.cTitle}>งาน</Text>
          <Text style={styles.cStatus}>สถานะ</Text>
        </View>
        {data.maintenance.length === 0 ? (
          <Text style={styles.empty}>ไม่มีงานประจำในเดือนนี้</Text>
        ) : (
          data.maintenance.map((m, idx) => (
            <View key={idx} style={[styles.row, idx % 2 === 1 ? styles.rowAlt : {}]} wrap={false}>
              <Text style={styles.cDate}>{fmtShortDate(m.date)}</Text>
              <Text style={styles.cTitle}>{m.title}</Text>
              <Text style={styles.cStatus}>{m.status}</Text>
            </View>
          ))
        )}

        <Text
          style={styles.pageNum}
          render={({ pageNumber, totalPages }) => `หน้า ${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}

export async function buildRepairReportPdf(data: RepairReportData): Promise<Blob> {
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
