// Thai baht amount in words for statutory documents (หนังสือรับรองเงินเดือน prints the salary
// as text, e.g. 17,500.00 → "หนึ่งหมื่นเจ็ดพันห้าร้อยบาทถ้วน").

const DIGIT = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const UNIT = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

// 1–999,999 → Thai words. หนึ่ง→เอ็ด in the units place of a multi-digit group,
// สอง→ยี่ in the tens place, and bare สิบ for a leading 1 in the tens place.
function readUnderMillion(n: number): string {
  const s = String(n);
  const len = s.length;
  let out = '';
  for (let i = 0; i < len; i++) {
    const d = Number(s[i]);
    const pos = len - i - 1;
    if (d === 0) continue;
    if (pos === 0 && d === 1 && len > 1) out += 'เอ็ด';
    else if (pos === 1 && d === 2) out += 'ยี่สิบ';
    else if (pos === 1 && d === 1) out += 'สิบ';
    else out += DIGIT[d] + UNIT[pos];
  }
  return out;
}

export function thaiNumberText(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return 'ศูนย์';
  if (n >= 1_000_000) {
    const rest = n % 1_000_000;
    return `${thaiNumberText(Math.floor(n / 1_000_000))}ล้าน${rest ? readUnderMillion(rest) : ''}`;
  }
  return readUnderMillion(n);
}

// satang → 'สามหมื่นบาทถ้วน' / 'หนึ่งร้อยยี่สิบเอ็ดบาทห้าสิบสตางค์'
export function bahtText(satang: number): string {
  const total = Math.round(satang);
  const baht = Math.floor(total / 100);
  const st = total % 100;
  if (baht === 0 && st === 0) return 'ศูนย์บาทถ้วน';
  const bahtPart = baht > 0 ? `${thaiNumberText(baht)}บาท` : '';
  return st > 0 ? `${bahtPart}${thaiNumberText(st)}สตางค์` : `${bahtPart}ถ้วน`;
}
