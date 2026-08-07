/**
 * Downloadable payslip PDF — what an employee saves or forwards to a bank/landlord.
 *
 * HR could already print a slip (payslip-form-print.tsx is an HTML print layout aimed at
 * pre-printed forms); an employee had no way to get a file at all. This renders the same figures
 * as PayslipView into a standalone A4 sheet.
 *
 * Thai typography rules per the repo's react-pdf convention: register Sarabun, treat each run as
 * one unbreakable word (Thai has no inter-word spaces, so the layout engine otherwise clips the
 * final glyph of a wrapped line), and pad left-aligned Thai strings with a trailing space.
 */

import { Document, Page, Text, View, StyleSheet, Font, pdf } from '@react-pdf/renderer';
import type { PayslipDetailData } from './payslip-view';

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
Font.registerHyphenationCallback((word) => [word]);

function thaiSafe(s: string | null | undefined): string {
  const v = (s ?? '').toString();
  return v.length ? `${v} ` : v;
}

const NAVY = '#1e3a8a';

const styles = StyleSheet.create({
  page: { fontFamily: 'Sarabun', fontSize: 10, padding: 40, color: '#111827' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 2, borderColor: NAVY, paddingBottom: 8 },
  company: { fontSize: 13, fontWeight: 700, color: NAVY },
  companyAddr: { fontSize: 9, color: '#6b7280', maxWidth: 280 },
  title: { fontSize: 15, fontWeight: 700, color: NAVY, textAlign: 'right' },
  period: { fontSize: 10, color: '#6b7280', textAlign: 'right' },

  meta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginBottom: 4 },
  metaCell: { width: '50%', flexDirection: 'row', marginBottom: 3 },
  metaLabel: { width: 90, color: '#6b7280' },
  metaValue: { flex: 1, fontWeight: 700 },

  cols: { flexDirection: 'row', gap: 14, marginTop: 10 },
  col: { flex: 1 },
  colHead: { fontSize: 11, fontWeight: 700, backgroundColor: '#f1f5f9', paddingVertical: 4, paddingHorizontal: 6, borderTopWidth: 1, borderColor: NAVY },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5, paddingHorizontal: 6, borderBottomWidth: 0.4, borderColor: '#e5e7eb' },
  rowLabel: { flex: 1, paddingRight: 6 },
  rowAmt: { width: 78, textAlign: 'right' },
  subtotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 6, borderTopWidth: 1, borderColor: '#94a3b8', fontWeight: 700 },

  net: { marginTop: 16, backgroundColor: '#f1f5f9', borderLeftWidth: 4, borderColor: NAVY, padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  netLabel: { fontSize: 12, fontWeight: 700 },
  netValue: { fontSize: 17, fontWeight: 700, color: NAVY },

  foot: { position: 'absolute', bottom: 28, left: 40, right: 40, fontSize: 8, color: '#9ca3af', textAlign: 'center' },
});

const money = (satang: number) =>
  (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TH_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function Line({ label, amount }: { label: string; amount: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{thaiSafe(label)}</Text>
      <Text style={styles.rowAmt}>{money(amount)}</Text>
    </View>
  );
}

function PayslipDocument({ data }: { data: PayslipDetailData }) {
  const { payslip, payrun, earnings, deductions } = data;
  const periodText = payrun
    ? `${TH_MONTHS[(payrun.period_month ?? 1) - 1]} ${payrun.period_year + 543}`
    : '—';
  const earnTotal = earnings.reduce((s, e) => s + (e.amount_satang ?? 0), 0) || payslip.gross_satang;

  return (
    <Document title={`สลิปเงินเดือน ${periodText}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.company}>{thaiSafe(payrun?.company?.name ?? '')}</Text>
            {payrun?.company?.address && (
              <Text style={styles.companyAddr}>{thaiSafe(payrun.company.address)}</Text>
            )}
          </View>
          <View>
            <Text style={styles.title}>สลิปเงินเดือน </Text>
            <Text style={styles.period}>งวด {thaiSafe(periodText)}</Text>
          </View>
        </View>

        <View style={styles.meta}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>ชื่อ-นามสกุล</Text>
            <Text style={styles.metaValue}>{thaiSafe(payslip.employee_name ?? '—')}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>รหัสพนักงาน</Text>
            <Text style={styles.metaValue}>{thaiSafe(payslip.employee_code ?? '—')}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>วันที่จ่าย</Text>
            <Text style={styles.metaValue}>{thaiSafe(payrun?.pay_date ?? '—')}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>บัญชีธนาคาร</Text>
            <Text style={styles.metaValue}>{thaiSafe(payslip.bank_account_no ?? '—')}</Text>
          </View>
        </View>

        <View style={styles.cols}>
          <View style={styles.col}>
            <Text style={styles.colHead}>รายได้ </Text>
            {earnings.length === 0 ? (
              <Line label="เงินเดือน" amount={payslip.gross_satang} />
            ) : (
              earnings.map((e, i) => (
                <Line key={`e-${i}`} label={e.label ?? '—'} amount={e.amount_satang ?? 0} />
              ))
            )}
            <View style={styles.subtotal}>
              <Text>รวมรายได้ </Text>
              <Text style={styles.rowAmt}>{money(earnTotal)}</Text>
            </View>
          </View>

          <View style={styles.col}>
            <Text style={styles.colHead}>รายการหัก </Text>
            {deductions.map((d, i) => (
              <Line key={`d-${i}`} label={d.label ?? '—'} amount={d.amount_satang ?? 0} />
            ))}
            {payslip.sso_satang > 0 && <Line label="ประกันสังคม" amount={payslip.sso_satang} />}
            {payslip.tax_satang > 0 && <Line label="ภาษีหัก ณ ที่จ่าย" amount={payslip.tax_satang} />}
            <View style={styles.subtotal}>
              <Text>รวมรายการหัก </Text>
              <Text style={styles.rowAmt}>{money(payslip.total_deduction_satang)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.net}>
          <Text style={styles.netLabel}>เงินได้สุทธิ </Text>
          <Text style={styles.netValue}>{money(payslip.net_satang)} บาท </Text>
        </View>

        <Text style={styles.foot}>
          เอกสารนี้ออกจากระบบ ไม่ต้องลงนาม — โปรดเก็บไว้เป็นหลักฐาน
        </Text>
      </Page>
    </Document>
  );
}

/** Render to a Blob for download. Lazy-import this module so react-pdf stays out of the page chunk. */
export async function buildPayslipPdf(data: PayslipDetailData): Promise<Blob> {
  return pdf(<PayslipDocument data={data} />).toBlob();
}
