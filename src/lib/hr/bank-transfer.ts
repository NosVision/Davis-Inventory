// P4.4: payroll → bank direct-credit file (โอนเงินเดือนผ่านธนาคาร).
//
// Pay date is the last day of the period month; the standard salary channel is Bangkok Bank
// (BBL) direct credit (§E "โอน BBL"). The EXACT proprietary fixed-width BBL layout is only
// released inside a signed Bualuang Business iBanking / Direct Credit agreement and its field
// widths vary per corporate profile, so we ship a documented CSV that an accountant maps onto
// the bank's portal template. What IS stable across all Thai banks and is encoded correctly
// here: amount = integer satang with 2 implied decimals (emitted as N.NN, never re-rounded),
// the 3-digit ITMX bank code (BBL = 002), same-bank vs interbank driven by that code, and a
// citizen-id / reference match key. A fixed-width exporter can be added later off the same
// BankTransferRow model once a client's real BBL spec sheet is in hand.

/** ITMX / BOT 3-digit bank codes (the ones a payroll file realistically targets). */
export const BANK_CODES: Record<string, string> = {
  BBL: '002', // Bangkok Bank — the in-house/cheapest channel for these payslips
  KBANK: '004',
  KTB: '006',
  TTB: '011',
  SCB: '014',
  BAY: '025', // Krungsri
  CIMB: '022',
  UOB: '024',
  GSB: '030',
  BAAC: '034',
  LHBANK: '073',
  KKP: '069',
  TISCO: '067',
  GHB: '033',
};

export const BBL_BANK_CODE = BANK_CODES.BBL;

/** One payee line, built from a finalized payslip + the employee's bank details. */
export interface BankTransferRow {
  bankCode: string; // 3-digit ITMX code; defaults to BBL when the employee's bank is unknown
  accountNo: string; // digits only (dashes/spaces stripped)
  accountName: string; // payee name as it should appear at the bank
  netSatang: number; // integer satang — the payslip net; encoded with 2 implied decimals
  citizenId?: string | null; // 13-digit Thai national id — a strong bank-side match key
  reference?: string | null; // reconciliation ref, e.g. `${payrunId}-${employeeCode}`
  email?: string | null;
  mobile?: string | null;
}

export interface BankTransferMeta {
  payDate: string; // YYYY-MM-DD (value date); emitted as DDMMYYYY Gregorian in the file
  companyName?: string | null;
}

const CSV_HEADER = [
  'receiving_bank_code',
  'receiving_account_no',
  'receiving_account_name',
  'amount',
  'citizen_id',
  'reference',
  'email',
  'mobile',
] as const;

// English + Thai name fragments → code. Ordered longest-first per code isn't needed because
// fragments are distinctive; matched with a loose `includes` on the ORIGINAL string (not a
// letters-only squashed form, which caused "BangkokBank" to contain "KBANK").
const NAME_ALIASES: { needle: string; code: string }[] = [
  { needle: 'bangkok bank', code: '002' }, { needle: 'bualuang', code: '002' }, { needle: 'กรุงเทพ', code: '002' },
  { needle: 'kasikorn', code: '004' }, { needle: 'kbank', code: '004' }, { needle: 'กสิกร', code: '004' },
  { needle: 'krung thai', code: '006' }, { needle: 'krungthai', code: '006' }, { needle: 'ktb', code: '006' }, { needle: 'กรุงไทย', code: '006' },
  { needle: 'ttb', code: '011' }, { needle: 'thanachart', code: '011' }, { needle: 'ทหารไทย', code: '011' }, { needle: 'ธนชาต', code: '011' },
  { needle: 'siam commercial', code: '014' }, { needle: 'scb', code: '014' }, { needle: 'ไทยพาณิชย์', code: '014' },
  { needle: 'krungsri', code: '025' }, { needle: 'ayudhya', code: '025' }, { needle: 'กรุงศรี', code: '025' },
  { needle: 'cimb', code: '022' },
  { needle: 'uob', code: '024' },
  { needle: 'government savings', code: '030' }, { needle: 'ออมสิน', code: '030' },
  { needle: 'baac', code: '034' }, { needle: 'ธกส', code: '034' }, { needle: 'เกษตร', code: '034' },
  { needle: 'government housing', code: '033' }, { needle: 'อาคารสงเคราะห์', code: '033' },
  { needle: 'kiatnakin', code: '069' }, { needle: 'kkp', code: '069' },
  { needle: 'tisco', code: '067' },
  { needle: 'land and houses', code: '073' }, { needle: 'lh bank', code: '073' },
];

/** Map a bank name / 3-digit code to a 3-digit ITMX code; falls back to BBL (in-house). */
export function resolveBankCode(bankNameOrCode: string | null | undefined): string {
  if (!bankNameOrCode) return BBL_BANK_CODE;
  const raw = bankNameOrCode.trim();
  if (/^\d{3}$/.test(raw)) return raw; // already a 3-digit code
  const hay = raw.toLowerCase();
  for (const { needle, code } of NAME_ALIASES) {
    if (hay.includes(needle)) return code;
  }
  return BBL_BANK_CODE;
}

/** Strip everything but digits from an account number. */
export function normalizeAccountNo(acct: string | null | undefined): string {
  return (acct ?? '').replace(/\D/g, '');
}

/** satang integer → "N.NN" without thousands separators (final display string, no re-rounding). */
export function satangToAmountField(satang: number): string {
  const sign = satang < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(satang));
  const baht = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}${baht}.${String(cents).padStart(2, '0')}`;
}

/** YYYY-MM-DD → DDMMYYYY (Gregorian). Returns '' for a malformed input. */
export function toDDMMYYYY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  return `${m[3]}${m[2]}${m[1]}`;
}

/** Escape a CSV cell (quote if it contains comma, quote, or newline). */
function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Build the direct-credit CSV. One row per payee, plus a header row. Rows with a non-positive
 * net or an empty account number are DROPPED from the payment file and returned in `skipped`
 * (a zero/negative-net slip must never generate a transfer; a missing account can't be paid by
 * file and needs manual handling). The caller should surface `skipped` to the HR user.
 */
export function buildBankTransferCsv(
  rows: BankTransferRow[],
  _meta: BankTransferMeta,
): { csv: string; count: number; totalSatang: number; skipped: BankTransferRow[] } {
  const payable: BankTransferRow[] = [];
  const skipped: BankTransferRow[] = [];
  for (const r of rows) {
    const acct = normalizeAccountNo(r.accountNo);
    if (r.netSatang > 0 && acct.length > 0) payable.push({ ...r, accountNo: acct });
    else skipped.push(r);
  }

  const lines = [CSV_HEADER.join(',')];
  let totalSatang = 0;
  for (const r of payable) {
    totalSatang += r.netSatang;
    lines.push(
      [
        r.bankCode || BBL_BANK_CODE,
        r.accountNo,
        r.accountName ?? '',
        satangToAmountField(r.netSatang),
        r.citizenId ?? '',
        r.reference ?? '',
        r.email ?? '',
        r.mobile ?? '',
      ]
        .map((c) => csvCell(String(c)))
        .join(','),
    );
  }

  return { csv: lines.join('\r\n') + '\r\n', count: payable.length, totalSatang, skipped };
}
