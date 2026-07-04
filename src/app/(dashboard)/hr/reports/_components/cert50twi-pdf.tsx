'use client';

/**
 * หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) — annual per-employee withholding
 * certificate (P5.2 §J9). One A4 page per employee, built from the reports
 * route's cert50twi aggregation. react-pdf + NotoSansThai + whole-word
 * hyphenation (Thai has no inter-word spaces → prevents last-glyph clipping).
 * Lazy-loaded via dynamic import.
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
  page: { fontFamily: 'NotoSansThai', fontSize: 11, paddingTop: 40, paddingBottom: 44, paddingHorizontal: 44, color: '#111827', lineHeight: 1.5 },
  formNo: { fontSize: 9, color: '#6b7280', textAlign: 'right' },
  title: { fontSize: 15, fontWeight: 700, textAlign: 'center', marginTop: 4 },
  subtitle: { fontSize: 11, textAlign: 'center', color: '#374151', marginBottom: 14 },
  box: { borderWidth: 0.75, borderColor: '#9ca3af', borderRadius: 4, padding: 8, marginBottom: 10 },
  boxLabel: { fontSize: 9, color: '#6b7280', marginBottom: 2 },
  boxValue: { fontSize: 12, fontWeight: 700 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 0.5, borderColor: '#e5e7eb' },
  rowLabel: { fontSize: 11, color: '#374151' },
  rowValue: { fontSize: 11, fontWeight: 700, textAlign: 'right' },
  amountBox: { marginTop: 8, borderTopWidth: 1.5, borderColor: '#0d9488', paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between' },
  amountLabel: { fontSize: 12, fontWeight: 700, color: '#0f766e' },
  amountValue: { fontSize: 14, fontWeight: 700, color: '#0f766e' },
  signBlock: { marginTop: 40, alignItems: 'flex-end', paddingRight: 16 },
  signLine: { width: 180, borderBottomWidth: 0.75, borderColor: '#9ca3af', height: 26 },
  signCap: { fontSize: 10, color: '#6b7280', textAlign: 'center', width: 180, marginTop: 3 },
  foot: { position: 'absolute', bottom: 22, left: 44, right: 44, fontSize: 8, color: '#9ca3af', textAlign: 'center' },
});

export interface Cert50TwiPdfRow {
  employee_name: string;
  tax_id: string | null;
  total_income_satang: number;
  total_tax_satang: number;
  total_sso_satang: number;
  months_count: number;
}
export interface Cert50TwiPdfData {
  company_name: string;
  year: number; // Gregorian
  issue_date_label: string; // Thai
  rows: Cert50TwiPdfRow[];
}

const baht = (s: number) => (s / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function CertPage({ company, year, issueDate, row }: { company: string; year: number; issueDate: string; row: Cert50TwiPdfRow }) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.formNo}>แบบ 50 ทวิ</Text>
      <Text style={styles.title}>หนังสือรับรองการหักภาษี ณ ที่จ่าย</Text>
      <Text style={styles.subtitle}>ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร · ปีภาษี {year + 543}</Text>

      <View style={styles.box}>
        <Text style={styles.boxLabel}>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย (ผู้จ่ายเงินได้)</Text>
        <Text style={styles.boxValue}>{company}</Text>
      </View>

      <View style={styles.box}>
        <Text style={styles.boxLabel}>ผู้ถูกหักภาษี ณ ที่จ่าย (ผู้มีเงินได้)</Text>
        <Text style={styles.boxValue}>{row.employee_name}</Text>
        <Text style={styles.boxLabel}>เลขประจำตัวผู้เสียภาษีอากร: {row.tax_id || '—'}</Text>
      </View>

      <View style={{ marginTop: 4 }}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>ประเภทเงินได้: เงินเดือน ค่าจ้าง (มาตรา 40(1))</Text>
          <Text style={styles.rowValue}>{row.months_count} เดือน</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>จำนวนเงินได้ที่จ่าย</Text>
          <Text style={styles.rowValue}>{baht(row.total_income_satang)} บาท</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>เงินสมทบกองทุนประกันสังคม (หักได้)</Text>
          <Text style={styles.rowValue}>{baht(row.total_sso_satang)} บาท</Text>
        </View>
      </View>

      <View style={styles.amountBox}>
        <Text style={styles.amountLabel}>ภาษีที่หักและนำส่งทั้งสิ้น</Text>
        <Text style={styles.amountValue}>{baht(row.total_tax_satang)} บาท</Text>
      </View>

      <View style={styles.signBlock}>
        <View style={styles.signLine} />
        <Text style={styles.signCap}>ผู้จ่ายเงิน / ผู้มีอำนาจลงนาม</Text>
        <Text style={styles.signCap}>ออกให้ ณ วันที่ {issueDate}</Text>
      </View>

      <Text style={styles.foot}>ออกโดยระบบบุคคล · {company} · ปีภาษี {year + 543}</Text>
    </Page>
  );
}

function Cert50TwiDocument({ data }: { data: Cert50TwiPdfData }) {
  return (
    <Document title={`50 ทวิ ${data.year + 543} — ${data.company_name}`}>
      {data.rows.map((row, i) => (
        <CertPage key={`${row.employee_name}-${i}`} company={data.company_name} year={data.year} issueDate={data.issue_date_label} row={row} />
      ))}
    </Document>
  );
}

export async function buildCert50TwiPdf(data: Cert50TwiPdfData): Promise<Blob> {
  return await pdf(<Cert50TwiDocument data={data} />).toBlob();
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
