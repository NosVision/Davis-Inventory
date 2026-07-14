'use client';

/**
 * HR certificate PDF (P5.2 §J9) — หนังสือรับรองการทำงาน / รับรองเงินเดือน.
 * Layout mirrors the group's legacy letter (Upper House template, owner ask 2026-07-15):
 * navy letterhead with Thai + English company name, centered title + date, indented body
 * with the salary amount in Thai words, signer-over-dotted-line block, and a navy company
 * footer (name/address/tel). Sarabun (looped Thai, the official-document standard) replaces
 * Noto Sans Thai. A trailing space on every Thai run (thaiSafe) stops @react-pdf from
 * clipping the final glyph — the hyphenation callback alone is not enough (same fix as
 * KPServicePro's PDFs).
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
  family: 'Sarabun',
  fonts: [
    { src: fontUrl('Sarabun-Regular.ttf'), fontWeight: 400 },
    { src: fontUrl('Sarabun-Bold.ttf'), fontWeight: 700 },
  ],
});
// Thai has no inter-word spaces → treat each run as one unbreakable word so the
// layout engine doesn't clip the final glyph of a wrapped line.
Font.registerHyphenationCallback((word) => [word]);

// A trailing space stops @react-pdf from clipping the final Thai glyph
// (e.g. "จำกัด" rendering as "จำกั"). Left/center-aligned text only.
function thaiSafe(s: string | null | undefined): string {
  const v = (s ?? '').toString();
  return v.length ? `${v} ` : v;
}

const NAVY = '#1e3a8a';

const styles = StyleSheet.create({
  page: { fontFamily: 'Sarabun', fontSize: 13, paddingTop: 52, paddingBottom: 130, paddingHorizontal: 64, color: '#111827', lineHeight: 1.8 },
  headName: { fontSize: 16, fontWeight: 700, color: NAVY },
  headNameEn: { fontSize: 14, fontWeight: 700, color: NAVY },
  title: { fontSize: 17, fontWeight: 700, textAlign: 'center', marginTop: 26 },
  dateLine: { fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 22 },
  para: { textIndent: 48, marginBottom: 12 },
  bold: { fontWeight: 700 },
  signBlock: { marginTop: 52, alignSelf: 'flex-end', alignItems: 'center', width: 250, marginRight: 6 },
  signName: { fontSize: 13, textAlign: 'center' },
  signDots: { fontSize: 13, textAlign: 'center', marginTop: 2 },
  signRole: { fontSize: 13, textAlign: 'center', marginTop: 2 },
  foot: { position: 'absolute', bottom: 40, left: 64, right: 64, color: NAVY },
  footName: { fontSize: 14, fontWeight: 700 },
  footNameEn: { fontSize: 12, fontWeight: 700 },
  footSmall: { fontSize: 10, marginTop: 1 },
});

export interface HrCertificateData {
  doc_no: string;
  issue_date_label: string; // Thai e.g. "15 กรกฎาคม 2569"
  company_name: string;
  company_name_en: string | null;
  company_address: string | null;
  company_phone: string | null;
  employee_name: string;
  position_name: string | null;
  start_date_label: string | null; // formal Thai e.g. "วันที่ 1 เดือน เมษายน พ.ศ. 2568"
  employment_type_label: string; // e.g. "พนักงานประจำ" / "พนักงานพาร์ทไทม์"
  with_salary: boolean;
  salary_period_word: string; // "เดือนละ" / "วันละ" / "ชั่วโมงละ"
  salary_number: string | null; // e.g. "17,500.00" (only if with_salary)
  salary_words: string | null; // e.g. "หนึ่งหมื่นเจ็ดพันห้าร้อยบาทถ้วน"
  issuer_name: string;
  issuer_role: string;
}

function CertificateDocument({ data }: { data: HrCertificateData }) {
  const kind = data.with_salary ? 'หนังสือรับรองเงินเดือน' : 'หนังสือรับรองการทำงาน';
  return (
    <Document title={`${kind} — ${data.employee_name}`}>
      <Page size="A4" style={styles.page}>
        {/* letterhead — Thai + English legal name, navy (legacy Upper House template) */}
        <Text style={styles.headName}>{thaiSafe(data.company_name)}</Text>
        {data.company_name_en ? <Text style={styles.headNameEn}>{thaiSafe(data.company_name_en)}</Text> : null}

        <Text style={styles.title}>{thaiSafe(kind)}</Text>
        <Text style={styles.dateLine}>{thaiSafe(`วันที่ ${data.issue_date_label}`)}</Text>

        <Text style={styles.para}>
          หนังสือฉบับนี้ให้ไว้เพื่อรับรองว่า <Text style={styles.bold}>{data.employee_name}</Text>
          {' '}เป็น{data.employment_type_label}ของ <Text style={styles.bold}>{thaiSafe(data.company_name)}</Text>
        </Text>

        <Text style={styles.para}>
          {data.position_name ? <>ตำแหน่ง <Text style={styles.bold}>{data.position_name}</Text>{' '}</> : null}
          {data.start_date_label ? <>โดยเริ่มปฏิบัติงานตั้งแต่ {data.start_date_label} จนถึงปัจจุบัน</> : <>ปัจจุบันยังคงปฏิบัติงานอยู่</>}
          {data.with_salary && data.salary_number ? (
            <>
              {' '}ซึ่งปัจจุบันมีอัตราเงินเดือน {data.salary_period_word}{' '}
              <Text style={styles.bold}>{data.salary_number}</Text> บาท
              {data.salary_words ? ` (${data.salary_words})` : ''} ซึ่งอัตรานี้ไม่รวมค่าตอบแทนและเงินพิเศษอื่นๆ{' '}
            </>
          ) : (
            ' '
          )}
        </Text>

        <Text style={styles.para}>{thaiSafe('ขอรับรองว่าข้อความข้างต้นเป็นความจริงทุกประการ')}</Text>

        <View style={styles.signBlock}>
          <Text style={styles.signName}>{thaiSafe(data.issuer_name)}</Text>
          <Text style={styles.signDots}>(.................................................)</Text>
          <Text style={styles.signRole}>{thaiSafe(data.issuer_role)}</Text>
        </View>

        {/* company footer — navy block, same as the legacy letter's bottom letterhead */}
        <View style={styles.foot}>
          <Text style={styles.footName}>{thaiSafe(data.company_name)}</Text>
          {data.company_name_en ? <Text style={styles.footNameEn}>{thaiSafe(data.company_name_en)}</Text> : null}
          {data.company_address ? <Text style={styles.footSmall}>{thaiSafe(data.company_address)}</Text> : null}
          {data.company_phone ? <Text style={styles.footSmall}>{thaiSafe(`Tel : ${data.company_phone}`)}</Text> : null}
        </View>
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
