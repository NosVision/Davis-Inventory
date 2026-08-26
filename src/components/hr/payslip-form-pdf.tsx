/**
 * Downloadable payslip PDF in the accountant's own form layout — A4 landscape, filling the sheet.
 *
 * Two things this is NOT. It is not a second set of numbers: the rows come from
 * `mapSlipToFormSlots`, the same function the printed form uses, so a downloaded slip and a printed
 * one can never disagree about a figure. And it does not replace the print path — that one is
 * pinned to 8.4in at 10px because it lands on 9x5.5" continuous security paper in an Epson LQ-310,
 * where every field must fall at a fixed physical position. Rescaling it to look better on A4 would
 * break the alignment it exists to hold. So printing keeps its calibrated layout, and downloading
 * gets this one, laid out for the paper it will actually be read on.
 *
 * Thai typography per the repo's react-pdf convention: Sarabun, each run treated as one unbreakable
 * word (Thai has no inter-word spaces, so a wrapped line otherwise loses its final glyph), and a
 * trailing space on left-aligned Thai strings.
 */

import { Document, Page, Text, View, StyleSheet, Font, pdf } from '@react-pdf/renderer';
import type { PayslipDetailData } from './payslip-view';
import { mapSlipToFormSlots } from './payslip-form-print';

function fontUrl(file: string): string {
  if (typeof window !== 'undefined') return `${window.location.origin}/fonts/${file}`;
  return `${process.env.NEXT_PUBLIC_APP_URL || ''}/fonts/${file}`;
}

Font.register({
  family: 'Sarabun',
  fonts: [
    { src: fontUrl('Sarabun-Regular.ttf'), fontWeight: 400 },
    { src: fontUrl('Sarabun-Bold.ttf'), fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const baht = (satang: number) =>
  (satang / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Thai runs get a trailing space — the no-break callback otherwise clips the last glyph. */
const thai = (s: string | null | undefined) => {
  const v = (s ?? '').toString();
  return v.length ? `${v} ` : '';
};

const dmy = (d?: string | null) => {
  if (!d) return '';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return y && m && dd ? `${dd}/${m}/${y}` : String(d);
};

const BORDER = '#111827';

const styles = StyleSheet.create({
  // Landscape A4 is 841.9 x 595.3pt. A 30pt margin leaves ~782pt of width for a form whose HTML
  // twin is 604pt wide — the extra room is what turns a stamp in the corner into a full sheet.
  page: { fontFamily: 'Sarabun', fontSize: 11, paddingVertical: 30, paddingHorizontal: 30, color: '#111827' },

  company: { fontSize: 16, fontWeight: 700, textAlign: 'center' },
  companyAddr: { fontSize: 10, color: '#4b5563', textAlign: 'center', marginTop: 2 },

  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginBottom: 10 },
  metaCell: { width: '33.33%', flexDirection: 'row', marginBottom: 4, paddingRight: 8 },
  metaLabel: { width: 74, color: '#6b7280' },
  metaValue: { flex: 1, fontWeight: 700 },

  body: { flexDirection: 'row', alignItems: 'flex-start' },
  table: { width: '77%' },
  side: { width: '23%', paddingLeft: 8 },

  row: { flexDirection: 'row' },
  // Negative margins collapse the shared borders, so neighbouring cells read as one ruled grid
  // rather than a stack of separate boxes with doubled lines.
  cell: { borderWidth: 0.75, borderColor: BORDER, paddingVertical: 4, paddingHorizontal: 4, marginRight: -0.75, marginBottom: -0.75 },
  head: { fontWeight: 700, textAlign: 'center' },
  desc: { width: '30%' },
  count: { width: '8%', textAlign: 'right' },
  amount: { width: '12%', textAlign: 'right' },

  boxLabel: { borderWidth: 0.75, borderColor: BORDER, paddingVertical: 4, textAlign: 'center', fontWeight: 700 },
  boxValue: { borderWidth: 0.75, borderColor: BORDER, paddingVertical: 4, paddingHorizontal: 4, textAlign: 'right', fontWeight: 700, marginTop: -0.75 },
  boxGap: { marginTop: 8 },
  sign: { borderWidth: 0.75, borderColor: BORDER, height: 54, marginTop: -0.75 },
});

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function FormDocument({ data }: { data: PayslipDetailData }) {
  const { payslip, payrun } = data;
  const { earn, ded } = mapSlipToFormSlots(data);
  const rows = Math.max(earn.length, ded.length);

  const monthLabel = payrun
    ? `${new Date(Date.UTC(payrun.period_year, payrun.period_month - 1, 1)).toLocaleString('en-US', { month: 'long' })} ${payrun.period_year}`
    : '—';
  const cycle = payrun as { cycle_start?: string | null; cycle_end?: string | null } | null;
  const periodLabel = cycle?.cycle_start ? `${dmy(cycle.cycle_start)} - ${dmy(cycle.cycle_end)}` : '';

  return (
    <Document title={`payslip-${payslip.employee_name ?? ''}-${monthLabel}`}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.company}>{thai(payrun?.company?.name)}</Text>
        {payrun?.company?.address ? <Text style={styles.companyAddr}>{thai(payrun.company.address)}</Text> : null}

        <View style={styles.metaGrid}>
          <Meta label="Code" value={payslip.employee_code ?? ''} />
          <Meta label="Last Name" value={thai(payslip.employee_name)} />
          <Meta label="Month" value={monthLabel} />
          <Meta label="Account Nur" value={payslip.bank_account_no ?? ''} />
          <Meta label="Nickname" value={thai(payslip.nickname)} />
          <Meta label="Period" value={periodLabel} />
        </View>

        <View style={styles.body}>
          <View style={styles.table}>
            <View style={styles.row}>
              <Text style={[styles.cell, styles.desc, styles.head]}>Description</Text>
              <Text style={[styles.cell, styles.count, styles.head]}>Count</Text>
              <Text style={[styles.cell, styles.amount, styles.head]}>Amount</Text>
              <Text style={[styles.cell, styles.desc, styles.head]}>Deduction</Text>
              <Text style={[styles.cell, styles.count, styles.head]}>Count</Text>
              <Text style={[styles.cell, styles.amount, styles.head]}>Amount</Text>
            </View>
            {Array.from({ length: rows }, (_, i) => (
              <View key={i} style={styles.row} wrap={false}>
                <Text style={[styles.cell, styles.desc]}>{thai(earn[i]?.label)}</Text>
                <Text style={[styles.cell, styles.count]}>{earn[i]?.count ?? ''}</Text>
                <Text style={[styles.cell, styles.amount]}>{earn[i] ? baht(earn[i].amount) : ''}</Text>
                <Text style={[styles.cell, styles.desc]}>{thai(ded[i]?.label)}</Text>
                <Text style={[styles.cell, styles.count]}>{ded[i]?.count ?? ''}</Text>
                <Text style={[styles.cell, styles.amount]}>{ded[i] ? baht(ded[i].amount) : ''}</Text>
              </View>
            ))}
          </View>

          <View style={styles.side}>
            <Text style={styles.boxLabel}>Total</Text>
            <Text style={styles.boxValue}>{baht(payslip.gross_satang)}</Text>

            <Text style={[styles.boxLabel, styles.boxGap]}>Total deduction</Text>
            <Text style={styles.boxValue}>{baht(payslip.total_deduction_satang)}</Text>

            <Text style={[styles.boxLabel, styles.boxGap]}>Net Pay</Text>
            <Text style={styles.boxValue}>{baht(payslip.net_satang)}</Text>

            <Text style={[styles.boxLabel, styles.boxGap]}>Signature</Text>
            <View style={styles.sign} />
          </View>
        </View>
      </Page>
    </Document>
  );
}

/** The slip as a downloadable A4-landscape PDF, in the accountant's form layout. */
export async function buildPayslipFormPdf(data: PayslipDetailData): Promise<Blob> {
  return pdf(<FormDocument data={data} />).toBlob();
}
