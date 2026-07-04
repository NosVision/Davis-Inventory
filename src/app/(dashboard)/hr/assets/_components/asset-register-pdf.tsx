'use client';

/**
 * ทะเบียนทรัพย์สิน (asset register) PDF (P1.5) — a printable inventory of the currently-filtered
 * HR asset list, mirroring the employee register. react-pdf + NotoSansThai + whole-word
 * hyphenation. Rows arrive already localized (category/status/holder). Lazy-loaded via import().
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
  page: { fontFamily: 'NotoSansThai', fontSize: 9, paddingTop: 26, paddingBottom: 32, paddingHorizontal: 24, color: '#111827' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottomWidth: 1.5, borderBottomColor: '#0d9488', paddingBottom: 5, marginBottom: 8 },
  title: { fontSize: 13, fontWeight: 700, color: '#0f766e' },
  sub: { fontSize: 9, color: '#6b7280', marginTop: 1 },
  meta: { fontSize: 9, textAlign: 'right', color: '#374151' },
  metaBig: { fontSize: 12, fontWeight: 700, color: '#0f766e' },
  head: { flexDirection: 'row', backgroundColor: '#f0fdfa', fontWeight: 700, paddingVertical: 3, paddingHorizontal: 2, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: '#99f6e4', color: '#134e4a' },
  row: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 2, borderBottomWidth: 0.3, borderColor: '#e5e7eb' },
  rowAlt: { backgroundColor: '#f9fafb' },
  totalRow: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 2, borderTopWidth: 1, borderColor: '#0d9488', backgroundColor: '#f0fdfa', fontWeight: 700 },
  cNo: { width: 24, textAlign: 'right', paddingRight: 4 },
  cCode: { width: 70 },
  cName: { flex: 1.8 },
  cCat: { flex: 1.1 },
  cHolder: { flex: 1.3 },
  cValue: { width: 74, textAlign: 'right' },
  cStatus: { width: 66, textAlign: 'center' },
  foot: { position: 'absolute', bottom: 14, left: 24, right: 24, fontSize: 7.5, color: '#9ca3af', flexDirection: 'row', justifyContent: 'space-between' },
});

export interface AssetRegisterRow {
  code: string;
  name: string;
  category: string;
  holder: string;
  value: string; // formatted THB
  status: string;
}
export interface AssetRegisterData {
  generated_label: string;
  count: number;
  total_value: string; // formatted THB
  rows: AssetRegisterRow[];
  labels: { title: string; no: string; code: string; name: string; category: string; holder: string; value: string; status: string; count: string; total: string; page: string };
}

function RegisterDocument({ data }: { data: AssetRegisterData }) {
  const L = data.labels;
  return (
    <Document title={L.title}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.title}>{L.title}</Text>
            <Text style={styles.sub}>{data.generated_label}</Text>
          </View>
          <View>
            <Text style={styles.meta}>{L.count}</Text>
            <Text style={styles.metaBig}>{data.count}</Text>
          </View>
        </View>

        <View style={styles.head} fixed>
          <Text style={styles.cNo}>{L.no}</Text>
          <Text style={styles.cCode}>{L.code}</Text>
          <Text style={styles.cName}>{L.name}</Text>
          <Text style={styles.cCat}>{L.category}</Text>
          <Text style={styles.cHolder}>{L.holder}</Text>
          <Text style={styles.cValue}>{L.value}</Text>
          <Text style={styles.cStatus}>{L.status}</Text>
        </View>

        {data.rows.map((r, i) => (
          <View key={i} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]} wrap={false}>
            <Text style={styles.cNo}>{i + 1}</Text>
            <Text style={styles.cCode}>{r.code || '-'}</Text>
            <Text style={styles.cName}>{r.name}</Text>
            <Text style={styles.cCat}>{r.category}</Text>
            <Text style={styles.cHolder}>{r.holder}</Text>
            <Text style={styles.cValue}>{r.value}</Text>
            <Text style={styles.cStatus}>{r.status}</Text>
          </View>
        ))}

        <View style={styles.totalRow} wrap={false}>
          <Text style={styles.cNo}> </Text>
          <Text style={styles.cCode}> </Text>
          <Text style={styles.cName}>{L.total}</Text>
          <Text style={styles.cCat}> </Text>
          <Text style={styles.cHolder}> </Text>
          <Text style={styles.cValue}>{data.total_value}</Text>
          <Text style={styles.cStatus}> </Text>
        </View>

        <View style={styles.foot} fixed>
          <Text>{L.title}</Text>
          <Text render={({ pageNumber, totalPages }) => `${L.page} ${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function buildAssetRegisterPdf(data: AssetRegisterData): Promise<Blob> {
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
