'use client';

/**
 * HR certificate PDF (P5.2 §J9) — หนังสือรับรองการทำงาน / รับรองเงินเดือน.
 * A one-page Thai letter an employee can request and HR issues on demand.
 * `withSalary=false` → work-only certificate (no pay figure). Thai fonts +
 * whole-word hyphenation callback avoid the last-glyph clipping that bites
 * wrapped Thai lines (there are no inter-word spaces to break on).
 *
 * Lazy-loaded via dynamic import so the ~600 KB react-pdf bundle stays out
 * of the /hr/certificates route chunk.
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
// Thai has no inter-word spaces → treat each run as one unbreakable word so the
// layout engine doesn't clip the final glyph of a wrapped line.
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: { fontFamily: 'NotoSansThai', fontSize: 12, paddingTop: 48, paddingBottom: 56, paddingHorizontal: 56, color: '#111827', lineHeight: 1.7 },
  companyName: { fontSize: 15, fontWeight: 700, color: '#0f766e' },
  companyAddr: { fontSize: 10, color: '#6b7280', marginTop: 2 },
  rule: { borderBottomWidth: 1.5, borderBottomColor: '#0d9488', marginTop: 8, marginBottom: 18 },
  docNo: { fontSize: 10, color: '#6b7280', textAlign: 'right' },
  title: { fontSize: 16, fontWeight: 700, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  para: { marginBottom: 10, textIndent: 36 },
  bold: { fontWeight: 700 },
  spacer: { height: 8 },
  signBlock: { marginTop: 48, alignItems: 'flex-end', paddingRight: 24 },
  signLine: { width: 200, borderBottomWidth: 0.75, borderColor: '#9ca3af', height: 28 },
  signName: { marginTop: 4, fontSize: 11, textAlign: 'center', width: 200 },
  signRole: { fontSize: 10, color: '#6b7280', textAlign: 'center', width: 200 },
  foot: { position: 'absolute', bottom: 24, left: 56, right: 56, fontSize: 8, color: '#9ca3af', textAlign: 'center' },
});

export interface HrCertificateData {
  doc_no: string;
  issue_date_label: string; // Thai e.g. "4 กรกฎาคม 2569"
  company_name: string;
  company_address: string | null;
  employee_name: string;
  position_name: string | null;
  start_date_label: string | null; // Thai
  employment_type_label: string; // e.g. "พนักงานประจำ" / "พนักงานพาร์ทไทม์"
  with_salary: boolean;
  salary_label: string | null; // e.g. "18,000 บาท/เดือน" (only if with_salary)
  issuer_name: string;
  issuer_role: string;
}

function CertificateDocument({ data }: { data: HrCertificateData }) {
  const kind = data.with_salary ? 'หนังสือรับรองเงินเดือน' : 'หนังสือรับรองการทำงาน';
  return (
    <Document title={`${kind} — ${data.employee_name}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.companyName}>{data.company_name}</Text>
        {data.company_address ? <Text style={styles.companyAddr}>{data.company_address}</Text> : null}
        <View style={styles.rule} />

        <Text style={styles.docNo}>เลขที่ {data.doc_no}</Text>
        <Text style={styles.docNo}>วันที่ {data.issue_date_label}</Text>

        <Text style={styles.title}>{kind}</Text>

        <Text style={styles.para}>
          หนังสือฉบับนี้ให้ไว้เพื่อรับรองว่า <Text style={styles.bold}>{data.employee_name}</Text>
          {' '}เป็น{data.employment_type_label}ของ <Text style={styles.bold}>{data.company_name}</Text>
          {data.position_name ? <>{' '}ตำแหน่ง <Text style={styles.bold}>{data.position_name}</Text></> : null}
          {data.start_date_label ? <>{' '}โดยเริ่มปฏิบัติงานตั้งแต่วันที่ <Text style={styles.bold}>{data.start_date_label}</Text> จนถึงปัจจุบัน</> : null}
          {' '}และยังคงปฏิบัติงานอยู่ ณ วันที่ออกหนังสือฉบับนี้
        </Text>

        {data.with_salary && data.salary_label ? (
          <Text style={styles.para}>
            โดยได้รับค่าจ้าง/เงินเดือนในอัตรา <Text style={styles.bold}>{data.salary_label}</Text>
          </Text>
        ) : null}

        <Text style={styles.para}>
          จึงออกหนังสือฉบับนี้ให้ไว้เพื่อเป็นหลักฐาน
        </Text>

        <View style={styles.signBlock}>
          <View style={styles.signLine} />
          <Text style={styles.signName}>({data.issuer_name})</Text>
          <Text style={styles.signRole}>{data.issuer_role}</Text>
        </View>

        <Text style={styles.foot}>
          เอกสารนี้ออกโดยระบบบุคคล · เลขที่ {data.doc_no} · {data.issue_date_label}
        </Text>
      </Page>
    </Document>
  );
}

export async function buildHrCertificatePdf(data: HrCertificateData): Promise<Blob> {
  return await pdf(<CertificateDocument data={data} />).toBlob();
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
