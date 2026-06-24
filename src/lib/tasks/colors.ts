// แมพชื่อสี (tailwind-ish) → ค่า hex สำหรับ accent + พื้นอ่อน (tint) ของห้องงาน
// ใช้ inline style เพื่อเลี่ยงปัญหา Tailwind purge กับ class แบบไดนามิก

export interface RoomColor {
  accent: string;
  tint: string;
}

const MAP: Record<string, RoomColor> = {
  indigo: { accent: '#6366f1', tint: '#eef0fe' },
  violet: { accent: '#8b5cf6', tint: '#f1ecfe' },
  rose: { accent: '#f43f5e', tint: '#ffe4e8' },
  red: { accent: '#ef4444', tint: '#fdecec' },
  orange: { accent: '#f97316', tint: '#fff1e6' },
  amber: { accent: '#f59e0b', tint: '#fff5e6' },
  green: { accent: '#16a34a', tint: '#e9f7ef' },
  emerald: { accent: '#10b981', tint: '#e7f8f1' },
  teal: { accent: '#14b8a6', tint: '#e6f7f5' },
  cyan: { accent: '#06b6d4', tint: '#e6f8fb' },
  sky: { accent: '#0ea5e9', tint: '#e6f6fe' },
  blue: { accent: '#3b82f6', tint: '#e8f0fe' },
  fuchsia: { accent: '#d946ef', tint: '#fbeafe' },
};

export function getRoomColor(name?: string | null): RoomColor {
  return MAP[name ?? ''] ?? MAP.indigo!;
}
