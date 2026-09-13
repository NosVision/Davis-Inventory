import { DayoffSwapQueue } from '@/components/hr/dayoff-swap-queue';

// HR's door to the day-off swap queue: acknowledge what the stores approved, and decide as the
// fallback for a store with nobody set up. The stores' own door is /schedule/swaps.
export default function HrSwapsPage() {
  return <DayoffSwapQueue mode="hr" />;
}
