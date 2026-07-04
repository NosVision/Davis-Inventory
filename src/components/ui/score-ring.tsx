import { cn } from '@/lib/utils/cn';

// ScoreRing — a circular progress "hero figure" (Tier 0) for percentage/score data (evaluation
// score_pct, acknowledgement ratios, completion). SVG-only, theme-aware via currentColor tones,
// so an eval result leads with the number instead of burying it in a row.
type Tone = 'accent' | 'good' | 'warn' | 'serious' | 'critical';

const toneText: Record<Tone, string> = {
  accent: 'text-indigo-500',
  good: 'text-emerald-500',
  warn: 'text-amber-500',
  serious: 'text-orange-500',
  critical: 'text-red-500',
};

interface ScoreRingProps {
  /** 0–100 */
  pct: number;
  size?: number;
  strokeWidth?: number;
  tone?: Tone;
  /** big centered label; defaults to `${pct}%` */
  label?: string;
  /** small caption under the label */
  caption?: string;
  className?: string;
}

export function ScoreRing({
  pct,
  size = 120,
  strokeWidth = 10,
  tone = 'accent',
  label,
  caption,
  className,
}: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - clamped / 100);

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={strokeWidth}
          className="fill-none stroke-gray-200 dark:stroke-gray-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className={cn('fill-none stroke-current', toneText[tone])}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
          {label ?? `${Math.round(clamped)}%`}
        </span>
        {caption && <span className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{caption}</span>}
      </div>
    </div>
  );
}
