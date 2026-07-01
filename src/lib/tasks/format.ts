// Client-side display helpers for Task Rooms

export type Locale = 'th' | 'en';

const TH_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const EN_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const AVATAR_COLORS = [
  '#6366f1', '#16a34a', '#f59e0b', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6',
];

/** อักษรย่อจากชื่อ (ตัวแรก) */
export function initial(name?: string | null): string {
  const s = (name ?? '').trim();
  return s ? s[0]!.toUpperCase() : '?';
}

/** สีพื้นหลัง avatar แบบคงที่ตาม id */
export function avatarColor(seed?: string | null): string {
  const s = seed ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** วันที่ย่อ + ปี เช่น "24 มิ.ย. 69" (th) / "24 Jun 26" (en) */
export function fmtThaiDate(value?: string | null, withYear = true, locale: Locale = 'th'): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const day = d.getDate();
  const months = locale === 'en' ? EN_MONTHS : TH_MONTHS;
  const mon = months[d.getMonth()];
  if (!withYear) return `${day} ${mon}`;
  // th: Buddhist year (พ.ศ.), en: Gregorian year — both 2-digit
  const year = locale === 'en' ? d.getFullYear() % 100 : (d.getFullYear() + 543) % 100;
  return `${day} ${mon} ${year.toString().padStart(2, '0')}`;
}

/** วันที่+เวลา เช่น "24 มิ.ย. 09:14" (th) / "24 Jun 09:14" (en) */
export function fmtThaiDateTime(value?: string | null, locale: Locale = 'th'): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** "วันนี้" / "เมื่อวาน" / "X วันที่แล้ว" (th) — "Today" / "Yesterday" / "{n} days ago" (en) */
export function relativeDaysTh(value?: string | null, locale: Locale = 'th'): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const ms = today.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0);
  const days = Math.round(ms / 86_400_000);
  if (locale === 'en') {
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return `${days} days ago`;
  }
  if (days <= 0) return 'วันนี้';
  if (days === 1) return 'เมื่อวาน';
  return `${days} วันที่แล้ว`;
}
