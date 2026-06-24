import {
  ClipboardList,
  Wrench,
  Wallet,
  Sparkles,
  Megaphone,
  Package,
  Utensils,
  CalendarDays,
  Repeat,
  ShieldCheck,
  Boxes,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  'clipboard-list': ClipboardList,
  wrench: Wrench,
  wallet: Wallet,
  sparkles: Sparkles,
  megaphone: Megaphone,
  package: Package,
  boxes: Boxes,
  utensils: Utensils,
  'calendar-days': CalendarDays,
  repeat: Repeat,
  'shield-check': ShieldCheck,
};

export function RoomIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = ICONS[name ?? ''] ?? ClipboardList;
  return <Icon className={className} />;
}
