'use client';

/**
 * ประวัติพนักงาน (employee profile / personnel file) PDF (P1.5) — a one-page A4 record for a single
 * employee, for the HR personnel folder. HR-only data (the detail route is HR-gated). react-pdf +
 * NotoSansThai + whole-word hyphenation. Fields arrive already localized / formatted from the page,
 * so this component is a pure layout. Lazy-loaded via import(). Bank account details are
 * intentionally omitted from the printout (financial PII); SSO/tax ids are kept for the file.
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
  page: { fontFamily: 'NotoSansThai', fontSize: 11, paddingTop: 40, paddingBottom: 44, paddingHorizontal: 48, color: '#111827' },
  head: { borderBottomWidth: 1.5, borderBottomColor: '#0d9488', paddingBottom: 8, marginBottom: 14 },
  docTitle: { fontSize: 11, color: '#6b7280' },
  name: { fontSize: 20, fontWeight: 700, color: '#0f766e', marginTop: 2 },
  codeStatus: { fontSize: 10, color: '#374151', marginTop: 3 },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: '#0f766e', borderBottomWidth: 0.5, borderBottomColor: '#99f6e4', paddingBottom: 2, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  field: { width: '50%', marginBottom: 6, paddingRight: 10 },
  label: { fontSize: 8.5, color: '#9ca3af' },
  value: { fontSize: 11, color: '#111827', marginTop: 1 },
  foot: { position: 'absolute', bottom: 22, left: 48, right: 48, fontSize: 8, color: '#9ca3af', flexDirection: 'row', justifyContent: 'space-between' },
});

export interface ProfileField { label: string; value: string }
export interface ProfileSection { title: string; fields: ProfileField[] }
export interface EmployeeProfileData {
  doc_title: string;
  name: string;
  code_status: string;
  sections: ProfileSection[];
  generated_label: string;
}

function Field({ f }: { f: ProfileField }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{f.label}</Text>
      <Text style={styles.value}>{f.value || '—'}</Text>
    </View>
  );
}

function ProfileDocument({ data }: { data: EmployeeProfileData }) {
  return (
    <Document title={`${data.doc_title} — ${data.name}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.head}>
          <Text style={styles.docTitle}>{data.doc_title}</Text>
          <Text style={styles.name}>{data.name}</Text>
          <Text style={styles.codeStatus}>{data.code_status}</Text>
        </View>

        {data.sections.map((s, si) => (
          <View key={si} style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <View style={styles.grid}>
              {s.fields.map((f, fi) => <Field key={fi} f={f} />)}
            </View>
          </View>
        ))}

        <View style={styles.foot} fixed>
          <Text>{data.doc_title}</Text>
          <Text>{data.generated_label}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function buildEmployeeProfilePdf(data: EmployeeProfileData): Promise<Blob> {
  return await pdf(<ProfileDocument data={data} />).toBlob();
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
