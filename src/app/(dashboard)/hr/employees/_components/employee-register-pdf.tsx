'use client';

/**
 * ทะเบียนพนักงาน (employee register) PDF (P1.5) — a printable roster for HR/audit.
 * Landscape A4, one row per employee. react-pdf + NotoSansThai + whole-word hyphenation
 * (Thai lines have no spaces to break on). Rows arrive already localized (pay type /
 * status labels) so this component stays locale-agnostic. Lazy-loaded via import().
 *
 * Columns are DYNAMIC (client ask 2026-07-23): the print modal picks which fields to
 * include (bank name / account no. joined the roster), so the document renders whatever
 * `data.columns` lists, in that order. Flex-based widths reflow to the chosen set.
 */

import { Document, Page, Text, View, StyleSheet, Font, pdf } from '@react-pdf/renderer';

type ColStyle = { width?: number; flex?: number; textAlign?: 'right' | 'center'; paddingRight?: number };

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
  foot: { position: 'absolute', bottom: 14, left: 24, right: 24, fontSize: 7.5, color: '#9ca3af', flexDirection: 'row', justifyContent: 'space-between' },
});

export type RegisterColumnKey =
  | 'code'
  | 'name'
  | 'position'
  | 'department'
  | 'store'
  | 'pay_type'
  | 'rate'
  | 'status'
  | 'bank_name'
  | 'bank_account_no';

// Per-column layout. Fixed widths for compact/numeric columns, flex for text ones —
// dropping a column lets the flex columns absorb the space.
const COL_STYLE: Record<RegisterColumnKey, ColStyle> = {
  code: { width: 56 },
  name: { flex: 1.6 },
  position: { flex: 1.1 },
  department: { flex: 0.9 },
  store: { flex: 1.1 },
  pay_type: { flex: 0.8 },
  rate: { width: 60, textAlign: 'right', paddingRight: 3 },
  status: { width: 48, textAlign: 'center' },
  bank_name: { width: 52 },
  bank_account_no: { width: 76 },
};

export type RegisterRow = Partial<Record<RegisterColumnKey, string>>;

export interface EmployeeRegisterData {
  company_name: string;
  generated_label: string; // Thai date-time
  headcount: number;
  /** Which columns to print, in order. */
  columns: RegisterColumnKey[];
  rows: RegisterRow[];
  labels: {
    title: string;
    no: string;
    headcount: string;
    page: string;
    /** Header label per column key. */
    cols: Record<RegisterColumnKey, string>;
  };
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
          {data.columns.map((c) => (
            <Text key={c} style={COL_STYLE[c]}>{L.cols[c]}</Text>
          ))}
        </View>

        {data.rows.map((r, i) => (
          <View key={i} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]} wrap={false}>
            <Text style={styles.cNo}>{i + 1}</Text>
            {data.columns.map((c) => (
              <Text key={c} style={COL_STYLE[c]}>{r[c] || '-'}</Text>
            ))}
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
