'use client';

/**
 * Per-room monthly task report PDF. Reuses the Noto Sans Thai font setup
 * from the repair report. Lazy-loaded via dynamic import.
 */

import { Document, Page, Text, View, StyleSheet, Font, pdf } from '@react-pdf/renderer';

function fontUrl(file: string): string {
  if (typeof window !== 'undefined') return `${window.location.origin}/fonts/${file}`;
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
  page: { fontFamily: 'NotoSansThai', fontSize: 9, paddingTop: 28, paddingBottom: 40, paddingHorizontal: 28, color: '#111827' },
  header: { borderBottomWidth: 2, borderBottomColor: '#6366f1', paddingBottom: 6, marginBottom: 10 },
  title: { fontSize: 14, fontWeight: 700, color: '#4338ca' },
  subTitle: { fontSize: 10, color: '#6b7280', marginTop: 2 },
  cards: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  card: { flex: 1, borderWidth: 0.5, borderColor: '#e5e7eb', borderRadius: 4, padding: 6 },
  cardLabel: { fontSize: 8, color: '#6b7280' },
  cardValue: { fontSize: 13, fontWeight: 700, color: '#111827', marginTop: 2 },
  tableHead: { flexDirection: 'row', backgroundColor: '#eef0fe', fontWeight: 700, paddingVertical: 4, paddingHorizontal: 3, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: '#c7ccfa', color: '#3730a3' },
  row: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 0.3, borderColor: '#e5e7eb' },
  rowAlt: { backgroundColor: '#f9fafb' },
  cTicket: { width: 64 },
  cDate: { width: 52 },
  cTitle: { flex: 1 },
  cStatus: { width: 80 },
  cAssignee: { width: 80 },
  empty: { fontSize: 9, color: '#9ca3af', paddingVertical: 8, textAlign: 'center' },
  pageNum: { position: 'absolute', bottom: 18, right: 28, fontSize: 8, color: '#9ca3af' },
});

export interface TaskReportRow {
  ticket: string;
  date: string;
  title: string;
  status: string;
  assignee: string;
}

export interface TaskReportData {
  room_name: string;
  month_label: string;
  generated_at_label: string;
  rows: TaskReportRow[];
  summary: { total: number; done: number; open: number };
}

function fmtShortDate(iso: string): string {
  const d = new Date(iso + (iso.length <= 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return iso;
  const yy = (d.getFullYear() + 543) % 100;
  return `${d.getDate()}/${d.getMonth() + 1}/${String(yy).padStart(2, '0')}`;
}

function ReportDocument({ data }: { data: TaskReportData }) {
  return (
    <Document title={`รายงานงาน ${data.room_name} ${data.month_label}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.title}>รายงานงาน — {data.room_name}</Text>
          <Text style={styles.subTitle}>เดือน {data.month_label}</Text>
          <Text style={styles.subTitle}>ออกรายงานเมื่อ {data.generated_at_label}</Text>
        </View>
        <View style={styles.cards}>
          <View style={styles.card}><Text style={styles.cardLabel}>งานทั้งหมด</Text><Text style={styles.cardValue}>{data.summary.total}</Text></View>
          <View style={styles.card}><Text style={styles.cardLabel}>เสร็จแล้ว</Text><Text style={styles.cardValue}>{data.summary.done}</Text></View>
          <View style={styles.card}><Text style={styles.cardLabel}>ค้าง</Text><Text style={styles.cardValue}>{data.summary.open}</Text></View>
        </View>
        <View style={styles.tableHead}>
          <Text style={styles.cTicket}>Ticket</Text>
          <Text style={styles.cDate}>วันที่</Text>
          <Text style={styles.cTitle}>หัวข้องาน</Text>
          <Text style={styles.cStatus}>สถานะ</Text>
          <Text style={styles.cAssignee}>ผู้รับผิดชอบ</Text>
        </View>
        {data.rows.length === 0 ? (
          <Text style={styles.empty}>ไม่มีงานในเดือนนี้</Text>
        ) : (
          data.rows.map((r, idx) => (
            <View key={idx} style={[styles.row, idx % 2 === 1 ? styles.rowAlt : {}]} wrap={false}>
              <Text style={styles.cTicket}>{r.ticket}</Text>
              <Text style={styles.cDate}>{fmtShortDate(r.date)}</Text>
              <Text style={styles.cTitle}>{r.title}</Text>
              <Text style={styles.cStatus}>{r.status}</Text>
              <Text style={styles.cAssignee}>{r.assignee}</Text>
            </View>
          ))
        )}
        <Text style={styles.pageNum} render={({ pageNumber, totalPages }) => `หน้า ${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}

export async function buildTaskReportPdf(data: TaskReportData): Promise<Blob> {
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
