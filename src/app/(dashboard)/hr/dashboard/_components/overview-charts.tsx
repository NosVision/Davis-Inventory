'use client';

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
  LabelList,
} from 'recharts';

// Chart pieces for the HR dashboard redesign. Colors come from the `.hr-viz` CSS custom
// properties defined by the page (status palette fixed across modes; blue/grid/ink swap with
// `.dark`), so every mark is theme-aware without re-rendering. Status colors always ship with
// a text label — never color alone.

export interface VenueRow {
  store_id: string;
  store_name: string;
  headcount: number;
  checked_in: number;
  on_leave: number;
  not_in: number;
}
export interface TrendDay { date: string; checked_in: number; late: number }
export interface LeaveTypeItem { code: string; name: string; days: number }

export interface ChartLabels {
  checkedIn: string;
  onLeave: string;
  notIn: string;
  late: string;
  days: string;
  people: string;
}

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid var(--viz-border)',
  background: 'var(--viz-tooltip-bg)',
  color: 'var(--viz-ink-strong)',
  fontSize: 12,
};

function LegendDots({ items }: { items: { label: string; colorVar: string }[] }) {
  return (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: `var(${it.colorVar})` }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Today's attendance composition — donut with the checked-in % as the hero figure. */
export function AttendanceDonut({
  checkedIn,
  onLeave,
  notIn,
  labels,
}: {
  checkedIn: number;
  onLeave: number;
  notIn: number;
  labels: ChartLabels;
}) {
  const total = checkedIn + onLeave + notIn;
  const pct = total > 0 ? Math.round((checkedIn / total) * 100) : 0;
  const data = [
    { name: labels.checkedIn, value: checkedIn, colorVar: '--viz-good' },
    { name: labels.onLeave, value: onLeave, colorVar: '--viz-warn' },
    { name: labels.notIn, value: notIn, colorVar: '--viz-crit' },
  ].filter((d) => d.value > 0);

  return (
    <div>
      <div className="relative h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data.length > 0 ? data : [{ name: '—', value: 1, colorVar: '--viz-grid' }]}
              dataKey="value"
              innerRadius="68%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {(data.length > 0 ? data : [{ name: '—', value: 1, colorVar: '--viz-grid' }]).map((d) => (
                <Cell key={d.name} fill={`var(${d.colorVar})`} />
              ))}
            </Pie>
            {data.length > 0 && <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => [`${v ?? 0} ${labels.people}`.trim(), n ?? '']} />}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums text-gray-900 dark:text-white">{pct}%</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{labels.checkedIn}</span>
        </div>
      </div>
      <LegendDots
        items={[
          { label: `${labels.checkedIn} ${checkedIn}`, colorVar: '--viz-good' },
          { label: `${labels.onLeave} ${onLeave}`, colorVar: '--viz-warn' },
          { label: `${labels.notIn} ${notIn}`, colorVar: '--viz-crit' },
        ]}
      />
    </div>
  );
}

/** Per-venue breakdown — horizontal 100%-width stacked bars, one row per venue. */
export function VenueStackedBars({
  rows,
  labels,
  onSelect,
}: {
  rows: VenueRow[];
  labels: ChartLabels;
  onSelect?: (storeId: string) => void;
}) {
  const height = Math.max(120, rows.length * 44 + 40);
  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 0 }} barSize={18}>
            <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
            <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--viz-ink)', fontSize: 11 }} axisLine={{ stroke: 'var(--viz-axis)' }} tickLine={false} />
            <YAxis
              type="category"
              dataKey="store_name"
              width={104}
              tick={{ fill: 'var(--viz-ink-strong)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--viz-hover)' }} />
            <Bar
              dataKey="checked_in"
              name={labels.checkedIn}
              stackId="a"
              fill="var(--viz-good)"
              stroke="var(--viz-surface)"
              strokeWidth={2}
              onClick={(d) => onSelect?.((d as unknown as VenueRow).store_id)}
              cursor={onSelect ? 'pointer' : undefined}
              isAnimationActive={false}
            />
            <Bar
              dataKey="on_leave"
              name={labels.onLeave}
              stackId="a"
              fill="var(--viz-warn)"
              stroke="var(--viz-surface)"
              strokeWidth={2}
              onClick={(d) => onSelect?.((d as unknown as VenueRow).store_id)}
              cursor={onSelect ? 'pointer' : undefined}
              isAnimationActive={false}
            />
            <Bar
              dataKey="not_in"
              name={labels.notIn}
              stackId="a"
              fill="var(--viz-crit)"
              stroke="var(--viz-surface)"
              strokeWidth={2}
              onClick={(d) => onSelect?.((d as unknown as VenueRow).store_id)}
              cursor={onSelect ? 'pointer' : undefined}
              isAnimationActive={false}
            >
              <LabelList dataKey="headcount" position="right" style={{ fill: 'var(--viz-ink)', fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <LegendDots
        items={[
          { label: labels.checkedIn, colorVar: '--viz-good' },
          { label: labels.onLeave, colorVar: '--viz-warn' },
          { label: labels.notIn, colorVar: '--viz-crit' },
        ]}
      />
    </div>
  );
}

/** Month-to-date daily trend — checked-in (blue) vs late (serious). */
export function MonthTrendChart({ days, labels }: { days: TrendDay[]; labels: ChartLabels }) {
  const data = days.map((d) => ({ ...d, day: Number(d.date.slice(8)) }));
  return (
    <div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
            <XAxis
              dataKey="day"
              tick={{ fill: 'var(--viz-ink)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--viz-axis)' }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis allowDecimals={false} tick={{ fill: 'var(--viz-ink)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(d) => `${labels.days} ${d}`} />
            <Line
              type="monotone"
              dataKey="checked_in"
              name={labels.checkedIn}
              stroke="var(--viz-blue)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="late"
              name={labels.late}
              stroke="var(--viz-serious)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <LegendDots
        items={[
          { label: labels.checkedIn, colorVar: '--viz-blue' },
          { label: labels.late, colorVar: '--viz-serious' },
        ]}
      />
    </div>
  );
}

/** Leave days by type this month — single-hue horizontal bars (magnitude compare). */
export function LeaveByTypeChart({ items, labels }: { items: LeaveTypeItem[]; labels: ChartLabels }) {
  const height = Math.max(96, items.length * 36 + 28);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={items} layout="vertical" margin={{ top: 0, right: 34, bottom: 0, left: 0 }} barSize={16}>
          <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
          <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--viz-ink)', fontSize: 11 }} axisLine={{ stroke: 'var(--viz-axis)' }} tickLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
            tick={{ fill: 'var(--viz-ink-strong)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--viz-hover)' }} formatter={(v) => [`${v ?? 0} ${labels.days}`, '']} />
          <Bar dataKey="days" name={labels.days} fill="var(--viz-blue)" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            <LabelList dataKey="days" position="right" style={{ fill: 'var(--viz-ink)', fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
