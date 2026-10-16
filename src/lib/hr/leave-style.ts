/**
 * How a leave reads on a day grid — the timesheet and the roster share it so a captain and HR see
 * the same code and colour for the same leave.
 *
 * One purple "ล" for every kind of leave made a sick day, a public holiday and a paid vacation
 * look the same (HR ask 2026-10-16). Each type gets the short code and colour HR chose —
 * SL ม่วง · LWP แดง · PH น้ำเงิน · VL ฟ้า; a type not listed here keeps the caller's generic block.
 * HR's colours sit near the timesheet's attendance palette (ขาด red, กำลังทำงาน blue, ทำวันหยุด
 * sky), so each is a deeper shade than its neighbour and the two-/three-letter code tells them
 * apart from the one-letter work statuses.
 */

export interface LeaveCellStyle {
  glyph: string;
  /** Tailwind classes for the filled block. */
  block: string;
  /** Tailwind class for the legend swatch. */
  dot: string;
}

const LEAVE_STYLE: Record<string, LeaveCellStyle> = {
  sick: { glyph: 'SL', block: 'bg-purple-600 text-white ring-purple-700', dot: 'bg-purple-600' },
  unpaid: { glyph: 'LWP', block: 'bg-red-700 text-white ring-red-800', dot: 'bg-red-700' },
  // ลากิจ is unpaid in every company too, so it reads as LWP.
  personal: { glyph: 'LWP', block: 'bg-red-700 text-white ring-red-800', dot: 'bg-red-700' },
  public_holiday: { glyph: 'PH', block: 'bg-blue-700 text-white ring-blue-800', dot: 'bg-blue-700' },
  vacation: { glyph: 'VL', block: 'bg-cyan-500 text-white ring-cyan-600', dot: 'bg-cyan-500' },
  special: { glyph: 'SP', block: 'bg-violet-400/90 text-white ring-violet-500', dot: 'bg-violet-400' },
  bereavement: { glyph: 'BL', block: 'bg-slate-500 text-white ring-slate-600', dot: 'bg-slate-500' },
  maternity: { glyph: 'ML', block: 'bg-pink-400 text-white ring-pink-500', dot: 'bg-pink-400' },
  paternity: { glyph: 'PT', block: 'bg-pink-400 text-white ring-pink-500', dot: 'bg-pink-400' },
  marriage: { glyph: 'MR', block: 'bg-rose-400 text-white ring-rose-500', dot: 'bg-rose-400' },
  ordination: { glyph: 'OR', block: 'bg-yellow-600 text-white ring-yellow-700', dot: 'bg-yellow-600' },
  military: { glyph: 'MI', block: 'bg-stone-500 text-white ring-stone-600', dot: 'bg-stone-500' },
  training: { glyph: 'TR', block: 'bg-cyan-600 text-white ring-cyan-700', dot: 'bg-cyan-600' },
  health_check: { glyph: 'HC', block: 'bg-emerald-700 text-white ring-emerald-800', dot: 'bg-emerald-700' },
};

export const GENERIC_LEAVE_STYLE: LeaveCellStyle = {
  glyph: 'L',
  block: 'bg-violet-400/90 text-white ring-violet-500',
  dot: 'bg-violet-400',
};

/** The block for a leave day: its type's code + colour, or `generic` for an unlisted type. */
export function leaveCellStyle(code: string | null | undefined, generic: LeaveCellStyle = GENERIC_LEAVE_STYLE): LeaveCellStyle {
  return (code && LEAVE_STYLE[code]) || generic;
}

/** Font size that fits a glyph in a small day block — leave codes run to three letters (LWP). */
export function glyphSizeClass(glyph: string): string {
  return glyph.length > 2 ? 'text-[8px] tracking-tighter' : glyph.length > 1 ? 'text-[9px] tracking-tight' : 'text-[11px]';
}
