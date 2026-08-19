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
import type { PayslipDetailData, PayslipLine } from './payslip-view';

/** Resolves one stored line into the wording the on-screen slip uses. */
type LabelFor = (line: PayslipLine) => string;

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

// The slip reads at arm's length now: every size below is the old one scaled up (10pt body → 13pt),
// with the page margin pulled in so the wider type keeps its column. Layout is untouched — the ask
// was a bigger sheet, not a different one.
//
// Rows stack in ONE full-width column rather than two side-by-side. Thai has no inter-word spaces
// and this document registers a no-break hyphenation callback (below), so a label that outgrows its
// column cannot wrap — it clips. Half-width columns survived 10pt; at 13pt "ค่าเดินทาง (วันขาดงาน)"
// would not. Full width buys the room the larger type needs.
const styles = StyleSheet.create({
  page: { fontFamily: 'Sarabun', fontSize: 13, padding: 34, color: '#111827' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 2, borderColor: NAVY, paddingBottom: 10 },
  company: { fontSize: 17, fontWeight: 700, color: NAVY },
  companyAddr: { fontSize: 11, color: '#6b7280', maxWidth: 300 },
  title: { fontSize: 20, fontWeight: 700, color: NAVY, textAlign: 'right' },
  period: { fontSize: 13, color: '#6b7280', textAlign: 'right' },

  meta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 15, marginBottom: 5 },
  metaCell: { width: '50%', flexDirection: 'row', marginBottom: 4 },
  metaLabel: { width: 115, color: '#6b7280' },
  metaValue: { flex: 1, fontWeight: 700 },

  section: { marginTop: 14 },
  colHead: { fontSize: 14, fontWeight: 700, backgroundColor: '#f1f5f9', paddingVertical: 6, paddingHorizontal: 8, borderTopWidth: 1, borderColor: NAVY },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 8, borderBottomWidth: 0.5, borderColor: '#e5e7eb' },
  rowLabel: { flex: 1, paddingRight: 10 },
  rowAmt: { width: 105, textAlign: 'right' },
  subtotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 8, borderTopWidth: 1, borderColor: '#94a3b8', fontWeight: 700 },

  net: { marginTop: 18, backgroundColor: '#f1f5f9', borderLeftWidth: 5, borderColor: NAVY, padding: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  netLabel: { fontSize: 15, fontWeight: 700 },
  netValue: { fontSize: 22, fontWeight: 700, color: NAVY },

  transfers: { marginTop: 8, paddingHorizontal: 8 },
  transferRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5 },
  transferTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, marginTop: 2, borderTopWidth: 0.5, borderColor: '#cbd5e1', fontWeight: 700 },

  foot: { position: 'absolute', bottom: 24, left: 34, right: 34, fontSize: 10, color: '#9ca3af', textAlign: 'center' },
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

function PayslipDocument({ data, labelFor }: { data: PayslipDetailData; labelFor: LabelFor }) {
  const { payslip, payrun, earnings, deductions } = data;
  const periodText = payrun
    ? `${TH_MONTHS[(payrun.period_month ?? 1) - 1]} ${payrun.period_year + 543}`
    : '—';
  const earnTotal = earnings.reduce((s, e) => s + (e.amount_satang ?? 0), 0) || payslip.gross_satang;
  // Earnings that leave the bank mid-month rather than with the salary.
  const svTipSatang = earnings
    .filter((e) => e.type === 'service_charge' || e.type === 'tip')
    .reduce((s, e) => s + (e.amount_satang ?? 0), 0);

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

        <View style={styles.section}>
          <Text style={styles.colHead}>รายได้ </Text>
          {earnings.length === 0 ? (
            <Line label="เงินเดือน" amount={payslip.gross_satang} />
          ) : (
            earnings.map((e, i) => (
              <Line key={`e-${i}`} label={labelFor(e)} amount={e.amount_satang ?? 0} />
            ))
          )}
          <View style={styles.subtotal}>
            <Text>รวมรายได้ </Text>
            <Text style={styles.rowAmt}>{money(earnTotal)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.colHead}>รายการหัก </Text>
          {/* SSO and tax are already rows in `deductions` (payroll.ts pushes them there before
              persisting). Re-adding them from payslip.sso_satang/tax_satang printed each twice —
              once as "sso", once as "ประกันสังคม" — so the listed lines out-summed the subtotal
              beneath them. The array is the whole story; render it and nothing else. */}
          {deductions.map((d, i) => (
            <Line key={`d-${i}`} label={labelFor(d)} amount={d.amount_satang ?? 0} />
          ))}
          <View style={styles.subtotal}>
            <Text>รวมรายการหัก </Text>
            <Text style={styles.rowAmt}>{money(payslip.total_deduction_satang)}</Text>
          </View>
        </View>

        <View style={styles.net}>
          <Text style={styles.netLabel}>เงินเดือนโอนสิ้นเดือน </Text>
          <Text style={styles.netValue}>{money(payslip.net_satang)} บาท </Text>
        </View>

        {/* Without this block the sheet does not add up: net_satang is the month-end transfer only,
            because payroll.ts takes SC/tips out of it — they go on the 15th. Set beside a รวมรายได้
            that includes them, the reader is left with รายได้ − หัก ≠ สุทธิ and no way to close the
            gap. Naming both transfers and their sum is what makes the document check out — the same
            two-transfer statement the on-screen slip carries. */}
        {svTipSatang > 0 && (
          <View style={styles.transfers}>
            <View style={styles.transferRow}>
              <Text>เซอร์วิสชาร์จ/ทิป — โอนรอบวันที่ 15 </Text>
              <Text style={styles.rowAmt}>{money(svTipSatang)}</Text>
            </View>
            <View style={styles.transferRow}>
              <Text>เงินเดือน — โอนสิ้นเดือน </Text>
              <Text style={styles.rowAmt}>{money(payslip.net_satang)}</Text>
            </View>
            <View style={styles.transferTotal}>
              <Text>รวมรับทั้งงวด </Text>
              <Text style={styles.rowAmt}>{money(payslip.net_satang + svTipSatang)}</Text>
            </View>
          </View>
        )}

        <Text style={styles.foot}>
          เอกสารนี้ออกจากระบบ ไม่ต้องลงนาม — โปรดเก็บไว้เป็นหลักฐาน
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Render to a Blob for download. Lazy-import this module so react-pdf stays out of the page chunk.
 *
 * `labelFor` comes from the caller because a react-pdf tree cannot use hooks, and the labels are
 * stored as machine keys. Omit it and the sheet prints those keys — which is what it used to do.
 */
export async function buildPayslipPdf(data: PayslipDetailData, labelFor?: LabelFor): Promise<Blob> {
  const resolve: LabelFor = labelFor ?? ((l) => l.label ?? '—');
  return pdf(<PayslipDocument data={data} labelFor={resolve} />).toBlob();
}
