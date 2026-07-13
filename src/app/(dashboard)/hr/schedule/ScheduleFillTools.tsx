'use client';

import { useState } from 'react';
import { CalendarDays, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui';

interface Template { id: string; label: string; color: string | null }
export type PatternSlot = { kind: 'shift'; id: string } | { kind: 'off' } | null;

// Weekdays shown Mon→Sun but indexed by JS getDay() (0=Sun).
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WD_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  isTh: boolean;
  templates: Template[];
  selectedCount: number;
  hasBrush: boolean;
  onFillSelected: (weekdays: number[]) => void;
  onApplyPattern: (pattern: PatternSlot[]) => void;
}

// Bulk fill tools for the roster draft (§C redesign): (1) paint the active brush onto the selected
// employees across chosen weekdays; (2) build a 1-week pattern and stamp it across the whole month.
// The active brush + per-cell painting live in the parent grid; this panel drives the bulk ops.
export default function ScheduleFillTools({ isTh, templates, selectedCount, hasBrush, onFillSelected, onApplyPattern }: Props) {
  const L = isTh
    ? { fill: 'เติมด่วน', scope: 'วันที่เติม', all: 'ทุกวัน', fillBtn: 'เติมกะที่เลือกให้พนักงานที่เลือก', selectedN: `${selectedCount} คนที่เลือก`,
        needSel: 'ติ๊กเลือกพนักงานก่อน', needBrush: 'เลือกกะ (แปรง) ก่อน', pattern: 'แพตเทิร์นรายสัปดาห์', patternHint: 'ตั้ง 1 สัปดาห์ แล้วลงซ้ำทั้งเดือนให้คนที่เลือก', apply: 'ลงทั้งเดือน', off: 'หยุด', none: '—' }
    : { fill: 'Quick fill', scope: 'Days', all: 'All', fillBtn: 'Fill the active shift for selected staff', selectedN: `${selectedCount} selected`,
        needSel: 'Tick some employees first', needBrush: 'Pick a shift (brush) first', pattern: 'Weekly pattern', patternHint: 'Set one week, stamp it across the whole month for selected staff', apply: 'Apply to month', off: 'OFF', none: '—' };

  // Day-of-week scope for the "fill" action (all selected by default).
  const [scope, setScope] = useState<Set<number>>(new Set(WEEKDAY_ORDER));
  const toggleScope = (wd: number) => {
    const next = new Set(scope);
    if (next.has(wd)) next.delete(wd); else next.add(wd);
    setScope(next);
  };

  // Weekly pattern: one slot per weekday, indexed by getDay().
  const [pattern, setPattern] = useState<PatternSlot[]>(() => Array(7).fill(null));
  const setSlot = (wd: number, value: string) => {
    const next = [...pattern];
    next[wd] = value === '' ? null : value === 'off' ? { kind: 'off' } : { kind: 'shift', id: value };
    setPattern(next);
  };
  const slotValue = (s: PatternSlot) => (s == null ? '' : s.kind === 'off' ? 'off' : s.id);

  const canBulk = selectedCount > 0 && hasBrush;

  return (
    <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900/50 dark:bg-indigo-900/10">
      {/* Fill the active brush across chosen weekdays for the selected employees. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-900 dark:text-indigo-200">
          <Wand2 className="h-4 w-4" /> {L.fill}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">· {L.selectedN}</span>
        <div className="flex-1" />
        <span className="text-[11px] text-gray-500 dark:text-gray-400">{L.scope}:</span>
        <button
          type="button"
          onClick={() => setScope(new Set(WEEKDAY_ORDER))}
          className="rounded-md border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300"
        >
          {L.all}
        </button>
        {WEEKDAY_ORDER.map((wd) => (
          <button
            key={wd}
            type="button"
            onClick={() => toggleScope(wd)}
            className={`h-6 w-7 rounded-md border text-[11px] font-medium ${
              scope.has(wd)
                ? 'border-indigo-500 bg-indigo-500 text-white'
                : 'border-gray-300 bg-white text-gray-500 dark:border-gray-600 dark:bg-gray-800'
            }`}
          >
            {(isTh ? WD_TH : WD_EN)[wd]}
          </button>
        ))}
        <Button
          size="sm"
          type="button"
          disabled={!canBulk || scope.size === 0}
          onClick={() => onFillSelected([...scope])}
          title={!hasBrush ? L.needBrush : selectedCount === 0 ? L.needSel : undefined}
        >
          {L.fillBtn}
        </Button>
      </div>

      {/* One-week pattern → stamped across the month. */}
      <div className="border-t border-indigo-100 pt-3 dark:border-indigo-900/40">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200">
          <CalendarDays className="h-3.5 w-3.5" /> {L.pattern}
          <span className="font-normal text-gray-400">· {L.patternHint}</span>
        </div>
        <div className="flex flex-wrap items-end gap-1.5">
          {WEEKDAY_ORDER.map((wd) => (
            <label key={wd} className="flex flex-col items-center text-[10px] text-gray-500 dark:text-gray-400">
              {(isTh ? WD_TH : WD_EN)[wd]}
              <select
                value={slotValue(pattern[wd])}
                onChange={(e) => setSlot(wd, e.target.value)}
                className="control mt-0.5 h-7 w-16 py-0 text-[11px]"
              >
                <option value="">{L.none}</option>
                <option value="off">{L.off}</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>{tpl.label}</option>
                ))}
              </select>
            </label>
          ))}
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={selectedCount === 0 || pattern.every((s) => s == null)}
            onClick={() => onApplyPattern(pattern)}
            title={selectedCount === 0 ? L.needSel : undefined}
          >
            {L.apply}
          </Button>
        </div>
      </div>
    </div>
  );
}
