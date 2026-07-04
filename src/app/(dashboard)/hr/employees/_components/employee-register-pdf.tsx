'use client';

/**
 * ทะเบียนพนักงาน (employee register) PDF (P1.5) — a printable roster of the currently-filtered
 * employee list for HR/audit. Landscape A4, one row per employee. react-pdf + NotoSansThai +
 * whole-word hyphenation (Thai lines have no spaces to break on). Rows arrive already localized
 * (pay type / status labels) so this component stays locale-agnostic. Lazy-loaded via import().
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
  page: { fontFamily: 'NotoSansThai', fontSize: 8.5, paddingTop: 26, paddingBottom: 32, paddingHorizontal: 24, color: '#111827' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottomWidth: 1.5, borderBottomColor: '#0d9488', paddingBottom: 5, marginBottom: 8 },
  title: { fontSize: 13, fontWeight: 700, color: '#0f766e' },
  sub: { fontSize: 9, color: '#6b7280', marginTop: 1 },
  meta: { fontSize: 9, textAlign: 'right', color: '#374151' },
  metaBig: { fontSize: 12, fontWeight: 700, color: '#0f766e' },
  head: { flexDirection: 'row', backgroundColor: '#f0fdfa', fontWeight: 700, paddingVertical: 3, paddingHorizontal: 2, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: '#99f6e4', color: '#134e4a' },
  row: { flexDirection: 'row', paddingVertical: 2.5, paddingHorizontal: 2, borderBottomWidth: 0.3, borderColor: '#e5e7eb' },
  rowAlt: { backgroundColor: '#f9fafb' },
  cNo: { width: 22, textAlign: 'right', paddingRight: 4 },
  cCode: { width: 60 },
  cName: { flex: 1.6 },
  cPos: { flex: 1.2 },
  cDept: { flex: 1 },
  cStore: { flex: 1.2 },
  cPay: { flex: 1 },
  cRate: { width: 62, textAlign: 'right' },
  cStatus: { width: 52, textAlign: 'center' },
  foot: { position: 'absolute', bottom: 14, left: 24, right: 24, fontSize: 7.5, color: '#9ca3af', flexDirection: 'row', justifyContent: 'space-between' },
});

export interface RegisterRow {
  code: string;
  name: string;
  position: string;
  department: string;
  store: string;
  pay_type: string;
  rate: string; // formatted THB
  status: string;
}
export interface EmployeeRegisterData {
  company_name: string;
  generated_label: string; // Thai date-time
  headcount: number;
  rows: RegisterRow[];
  labels: { title: string; no: string; code: string; name: string; position: string; department: string; store: string; pay: string; rate: string; status: string; headcount: string; page: string };
}

function RegisterDocument({ data }: { data: EmployeeRegisterData }) {
  const L = data.labels;
  return (
    <Document title={`${L.title} — ${data.company_name}`}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.title}>{L.title}</Text>
            <Text style={styles.sub}>{data.company_name} · {data.generated_label}</Text>
          </View>
          <View>
            <Text style={styles.meta}>{L.headcount}</Text>
            <Text style={styles.metaBig}>{data.headcount}</Text>
          </View>
        </View>

        <View style={styles.head} fixed>
          <Text style={styles.cNo}>{L.no}</Text>
          <Text style={styles.cCode}>{L.code}</Text>
          <Text style={styles.cName}>{L.name}</Text>
          <Text style={styles.cPos}>{L.position}</Text>
          <Text style={styles.cDept}>{L.department}</Text>
          <Text style={styles.cStore}>{L.store}</Text>
          <Text style={styles.cPay}>{L.pay}</Text>
          <Text style={styles.cRate}>{L.rate}</Text>
          <Text style={styles.cStatus}>{L.status}</Text>
        </View>

        {data.rows.map((r, i) => (
          <View key={i} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]} wrap={false}>
            <Text style={styles.cNo}>{i + 1}</Text>
            <Text style={styles.cCode}>{r.code || '-'}</Text>
            <Text style={styles.cName}>{r.name}</Text>
            <Text style={styles.cPos}>{r.position}</Text>
            <Text style={styles.cDept}>{r.department}</Text>
            <Text style={styles.cStore}>{r.store}</Text>
            <Text style={styles.cPay}>{r.pay_type}</Text>
            <Text style={styles.cRate}>{r.rate}</Text>
            <Text style={styles.cStatus}>{r.status}</Text>
          </View>
        ))}

        <View style={styles.foot} fixed>
          <Text>{data.company_name}</Text>
          <Text render={({ pageNumber, totalPages }) => `${L.page} ${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function buildEmployeeRegisterPdf(data: EmployeeRegisterData): Promise<Blob> {
  return await pdf(<RegisterDocument data={data} />).toBlob();
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
