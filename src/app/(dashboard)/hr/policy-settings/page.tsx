'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, AlarmClock, Hourglass, Coins, Gauge, RotateCcw } from 'lucide-react';
import { Button, PageHeader, SectionHeading, toast, usePromptDialog } from '@/components/ui';
import type { HrPolicies } from '@/lib/hr/policy';

// กติกา & นโยบายกลาง (owner requirement 2026-07-05): the rules that used to be code constants.
// Every save requires a reason and is audited with effective before/after. "ค่าเดิม" shows the
// engine default next to each knob so drifts are obvious.
type Effective = HrPolicies;

export default function HrPolicySettingsPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'กติกา & นโยบาย', subtitle: 'กฎที่เคยฝังในโค้ด — แก้ที่นี่ มีผลทั้งเครือ ทุกการแก้ต้องใส่เหตุผลและถูกบันทึก', late: 'ค่าปรับมาสาย (ต่อครั้ง)', t1: 'นาทีที่ 1 ขึ้นไป (บาท)', t2from: 'ตั้งแต่นาทีที่', t2: 'ปรับ (บาท)', t3from: 'ตั้งแต่นาทีที่ (ขั้นสูงสุด)', t3: 'ปรับสูงสุด (บาท)', lateSummary: 'สรุป: สาย 1–{t2from} นาที → {t1} บาท · {t2a}–{t2b} นาที → {t2} บาท · ตั้งแต่ {t3from} นาทีขึ้นไป → {t3} บาท (สูงสุด ไม่ทบเพิ่มตามชั่วโมง) · คิดต่อครั้งที่สาย', probation: 'ทดลองงาน', probationDays: 'จำนวนวันทดลองงาน', sc: 'Service Charge', scDivisor: 'ตัวหารวันลา (ลา 1 วัน หัก SC = ยอดแบ่ง ÷ ค่านี้)', carry: 'ยกยอดใบเตือน 200% / หักประเมินที่เกิน ไปเดือนถัดไป', workIndex: 'ดัชนีการทำงาน', wP: 'น้ำหนัก: ตรงต่อเวลา', wA: 'น้ำหนัก: การมาทำงาน', wC: 'น้ำหนัก: ความครบถ้วน', pLate: 'หักต่อวันสาย', pLate30: 'หักต่อ 30 นาทีสาย', pLateCap: 'เพดานโทษนาทีสาย', pAbsent: 'หักต่อวันขาด', pInc: 'หักต่อวันลงเวลาไม่ครบ', bE: 'เกณฑ์ "ดีเยี่ยม" ≥', bG: 'เกณฑ์ "ดี" ≥', bF: 'เกณฑ์ "พอใช้" ≥', save: 'บันทึกหมวดนี้', saved: 'บันทึกแล้ว', failed: 'บันทึกไม่สำเร็จ', loadFailed: 'โหลดไม่สำเร็จ', reasonTitle: 'เหตุผลที่แก้ (บันทึกลง audit)', defaultWord: 'ค่าเดิม', on: 'เปิด', off: 'ปิด', announce: 'การประกาศเงินเดือนออก', announceManual: 'HR กดประกาศเอง', announceManualHint: 'ปิดงวดแล้วยังไม่แจ้งใคร — HR กดปุ่ม "ประกาศเงินเดือนออก" เมื่อพร้อม', announceImmediate: 'แจ้งทันทีที่ปิดงวด', announceImmediateHint: 'พนักงานทุกคนได้รับแจ้งเตือนอัตโนมัติตอนกดปิดงวด', proBasis: 'วิธีนับวันเงินเดือนคนเข้า/ออกกลางงวด (prorate)', proCalendar: 'วันตามปฏิทินที่จ้าง', proCalendarHint: 'เงินที่ได้ = (เงินเดือน ÷ 30) × จำนวนวันที่เป็นพนักงานในงวด (นับทุกวันรวมวันหยุด)', proScheduled: 'วันทำงานตามกะ', proScheduledHint: 'นับเฉพาะวันที่ต้องมาทำงาน (ไม่รวมวันหยุด/นักขัตฤกษ์)' }
    : { title: 'Rules & policies', subtitle: 'Rules that used to live in code — edit here, applies group-wide; every change needs a reason and is audited', late: 'Late fine (per occurrence)', t1: 'From minute 1 (THB)', t2from: 'From minute', t2: 'Fine (THB)', t3from: 'From minute (top tier)', t3: 'Maximum fine (THB)', lateSummary: 'Summary: 1–{t2from} min → {t1} THB · {t2a}–{t2b} min → {t2} THB · {t3from} min and over → {t3} THB (capped — no per-hour escalation) · charged per late arrival', probation: 'Probation', probationDays: 'Probation days', sc: 'Service Charge', scDivisor: 'Leave-day divisor (1 leave day docks SC = allocation ÷ this)', carry: 'Carry 200%-warning / eval overflow into next month', workIndex: 'Work index', wP: 'Weight: punctuality', wA: 'Weight: attendance', wC: 'Weight: completeness', pLate: 'Penalty per late day', pLate30: 'Penalty per 30 late min', pLateCap: 'Late-minutes penalty cap', pAbsent: 'Penalty per absent day', pInc: 'Penalty per incomplete day', bE: '"Excellent" band ≥', bG: '"Good" band ≥', bF: '"Fair" band ≥', save: 'Save section', saved: 'Saved', failed: 'Save failed', loadFailed: 'Load failed', reasonTitle: 'Reason (audited)', defaultWord: 'default', on: 'On', off: 'Off', announce: 'Payday announcement', announceManual: 'HR announces manually', announceManualHint: 'Finalize sends nothing — HR presses "Announce payday" when ready', announceImmediate: 'Notify on finalize', announceImmediateHint: 'Everyone is pushed automatically the moment the run locks', proBasis: 'Mid-period hire/leave pay basis (prorate)', proCalendar: 'Employed calendar days', proCalendarHint: 'Pay = (salary ÷ 30) × days employed in the cycle (all days incl. days off)', proScheduled: 'Scheduled work days', proScheduledHint: 'Count only rostered work days (excludes days off / holidays)' };

  const { prompt, dialog } = usePromptDialog();
  const [eff, setEff] = useState<Effective | null>(null);
  const [defs, setDefs] = useState<Effective | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/policy-settings');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error);
      setEff(json.data?.effective ?? null);
      setDefs(json.data?.defaults ?? null);
    } catch {
      toast({ type: 'error', title: L.loadFailed });
    } finally {
      setLoading(false);
    }
  }, [L.loadFailed]);

  useEffect(() => { load(); }, [load]);

  const saveKey = useCallback(
    async (key: string, value: unknown) => {
      const reason = await prompt({ title: L.reasonTitle, required: true });
      if (!reason) return;
      setSaving(key);
      try {
        const res = await fetch('/api/hr/policy-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value, reason }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
        setEff(json.data?.effective ?? eff);
        toast({ type: 'success', title: L.saved });
      } catch (e) {
        toast({ type: 'error', title: L.failed, message: e instanceof Error ? e.message : undefined });
      } finally {
        setSaving(null);
      }
    },
    [prompt, eff, L]
  );

  const upd = (path: (draft: Effective) => void) =>
    setEff((prev) => {
      if (!prev) return prev;
      const draft = JSON.parse(JSON.stringify(prev)) as Effective;
      path(draft);
      return draft;
    });

  if (loading || !eff || !defs) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <PageHeader title={L.title} subtitle={L.subtitle} />
        <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      </div>
    );
  }

  const Num = ({ label, value, def, onChange, step = 1 }: { label: string; value: number; def: number; onChange: (n: number) => void; step?: number }) => (
    <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
      {label} <span className="font-normal text-gray-400">({L.defaultWord} {def})</span>
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="control mt-1 w-full" />
    </label>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageHeader title={L.title} subtitle={L.subtitle} />

      {/* late fines */}
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <SectionHeading title={L.late} extra={<AlarmClock className="h-4 w-4 text-amber-500" />} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Num label={L.t1} value={eff.late_tiers.tier1_satang / 100} def={defs.late_tiers.tier1_satang / 100} onChange={(n) => upd((d) => { d.late_tiers.tier1_satang = Math.round(n * 100); })} />
          <Num label={L.t2from} value={eff.late_tiers.tier2_from_min} def={defs.late_tiers.tier2_from_min} onChange={(n) => upd((d) => { d.late_tiers.tier2_from_min = n; })} />
          <Num label={L.t2} value={eff.late_tiers.tier2_satang / 100} def={defs.late_tiers.tier2_satang / 100} onChange={(n) => upd((d) => { d.late_tiers.tier2_satang = Math.round(n * 100); })} />
          <Num label={L.t3from} value={eff.late_tiers.tier3_from_min} def={defs.late_tiers.tier3_from_min} onChange={(n) => upd((d) => { d.late_tiers.tier3_from_min = n; })} />
          <Num label={L.t3} value={eff.late_tiers.tier3_satang / 100} def={defs.late_tiers.tier3_satang / 100} onChange={(n) => upd((d) => { d.late_tiers.tier3_satang = Math.round(n * 100); })} />
        </div>
        {/* Spell the resulting table out — the numbers alone read ambiguously (esp. that tier 3
            is a ceiling, not a per-hour charge). */}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {L.lateSummary
            .replace('{t2from}', String(eff.late_tiers.tier2_from_min - 1))
            .replace('{t1}', String(eff.late_tiers.tier1_satang / 100))
            .replace('{t2a}', String(eff.late_tiers.tier2_from_min))
            .replace('{t2b}', String(eff.late_tiers.tier3_from_min - 1))
            .replace('{t2}', String(eff.late_tiers.tier2_satang / 100))
            .replace('{t3from}', String(eff.late_tiers.tier3_from_min))
            .replace('{t3}', String(eff.late_tiers.tier3_satang / 100))}
        </p>
        <Button size="sm" isLoading={saving === 'late_tiers'} onClick={() => saveKey('late_tiers', eff.late_tiers)}>{L.save}</Button>
      </section>

      {/* probation */}
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <SectionHeading title={L.probation} extra={<Hourglass className="h-4 w-4 text-indigo-500" />} />
        <div className="grid grid-cols-2 gap-3">
          <Num label={L.probationDays} value={eff.probation_days} def={defs.probation_days} onChange={(n) => upd((d) => { d.probation_days = n; })} />
        </div>
        <Button size="sm" isLoading={saving === 'probation_days'} onClick={() => saveKey('probation_days', { days: eff.probation_days })}>{L.save}</Button>
      </section>

      {/* SC */}
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <SectionHeading title={L.sc} extra={<Coins className="h-4 w-4 text-emerald-500" />} />
        <div className="grid grid-cols-2 gap-3">
          <Num label={L.scDivisor} value={eff.sc_leave_divisor} def={defs.sc_leave_divisor} onChange={(n) => upd((d) => { d.sc_leave_divisor = n; })} />
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
            {L.carry}
            <button
              type="button"
              onClick={() => upd((d) => { d.warning_carry_enabled = !d.warning_carry_enabled; })}
              aria-pressed={eff.warning_carry_enabled}
              className={`mt-1 block rounded-lg px-3 py-2 text-xs font-semibold ${eff.warning_carry_enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}
            >
              {eff.warning_carry_enabled ? L.on : L.off}
            </button>
          </label>
        </div>
        <div className="flex gap-2">
          <Button size="sm" isLoading={saving === 'sc_leave_divisor'} onClick={() => saveKey('sc_leave_divisor', { divisor: eff.sc_leave_divisor })}>{L.save} (÷)</Button>
          <Button size="sm" variant="outline" isLoading={saving === 'warning_carry'} onClick={() => saveKey('warning_carry', { enabled: eff.warning_carry_enabled })}>{L.save} (carry)</Button>
        </div>
      </section>

      {/* payday announcement */}
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <SectionHeading title={L.announce} extra={<Gauge className="h-4 w-4 text-sky-500" />} />
        <div className="grid gap-2 sm:grid-cols-2">
          {(['manual', 'immediate'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => upd((d) => { d.payslip_announce_mode = mode; })}
              aria-pressed={eff.payslip_announce_mode === mode}
              className={`rounded-xl border p-3 text-left text-xs transition-colors ${eff.payslip_announce_mode === mode ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-900/20' : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40'}`}
            >
              <span className="block font-semibold text-gray-800 dark:text-gray-100">
                {mode === 'manual' ? L.announceManual : L.announceImmediate}
              </span>
              <span className="mt-0.5 block text-gray-500 dark:text-gray-400">
                {mode === 'manual' ? L.announceManualHint : L.announceImmediateHint}
              </span>
            </button>
          ))}
        </div>
        <Button size="sm" isLoading={saving === 'payslip_announce'} onClick={() => saveKey('payslip_announce', { mode: eff.payslip_announce_mode })}>{L.save}</Button>
      </section>

      {/* prorate basis (mid-period hire/leave) */}
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <SectionHeading title={L.proBasis} extra={<Gauge className="h-4 w-4 text-teal-500" />} />
        <div className="grid gap-2 sm:grid-cols-2">
          {(['calendar', 'scheduled'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => upd((d) => { d.prorate_basis = mode; })}
              aria-pressed={eff.prorate_basis === mode}
              className={`rounded-xl border p-3 text-left text-xs transition-colors ${eff.prorate_basis === mode ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-900/20' : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40'}`}
            >
              <span className="block font-semibold text-gray-800 dark:text-gray-100">
                {mode === 'calendar' ? L.proCalendar : L.proScheduled}
              </span>
              <span className="mt-0.5 block text-gray-500 dark:text-gray-400">
                {mode === 'calendar' ? L.proCalendarHint : L.proScheduledHint}
              </span>
            </button>
          ))}
        </div>
        <Button size="sm" isLoading={saving === 'prorate_basis'} onClick={() => saveKey('prorate_basis', { mode: eff.prorate_basis })}>{L.save}</Button>
      </section>

      {/* work index */}
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <SectionHeading title={L.workIndex} extra={<Gauge className="h-4 w-4 text-violet-500" />} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Num label={L.wP} value={eff.work_index.w_punctuality} def={defs.work_index.w_punctuality} onChange={(n) => upd((d) => { d.work_index.w_punctuality = n; })} />
          <Num label={L.wA} value={eff.work_index.w_attendance} def={defs.work_index.w_attendance} onChange={(n) => upd((d) => { d.work_index.w_attendance = n; })} />
          <Num label={L.wC} value={eff.work_index.w_completeness} def={defs.work_index.w_completeness} onChange={(n) => upd((d) => { d.work_index.w_completeness = n; })} />
          <Num label={L.pLate} value={eff.work_index.p_late_day} def={defs.work_index.p_late_day} onChange={(n) => upd((d) => { d.work_index.p_late_day = n; })} />
          <Num label={L.pLate30} value={eff.work_index.p_late_30min} def={defs.work_index.p_late_30min} onChange={(n) => upd((d) => { d.work_index.p_late_30min = n; })} />
          <Num label={L.pLateCap} value={eff.work_index.p_late_cap} def={defs.work_index.p_late_cap} onChange={(n) => upd((d) => { d.work_index.p_late_cap = n; })} />
          <Num label={L.pAbsent} value={eff.work_index.p_absent_day} def={defs.work_index.p_absent_day} onChange={(n) => upd((d) => { d.work_index.p_absent_day = n; })} />
          <Num label={L.pInc} value={eff.work_index.p_incomplete_day} def={defs.work_index.p_incomplete_day} onChange={(n) => upd((d) => { d.work_index.p_incomplete_day = n; })} />
          <Num label={L.bE} value={eff.work_index.band_excellent} def={defs.work_index.band_excellent} onChange={(n) => upd((d) => { d.work_index.band_excellent = n; })} />
          <Num label={L.bG} value={eff.work_index.band_good} def={defs.work_index.band_good} onChange={(n) => upd((d) => { d.work_index.band_good = n; })} />
          <Num label={L.bF} value={eff.work_index.band_fair} def={defs.work_index.band_fair} onChange={(n) => upd((d) => { d.work_index.band_fair = n; })} />
        </div>
        <Button size="sm" isLoading={saving === 'work_index'} onClick={() => saveKey('work_index', eff.work_index)}>{L.save}</Button>
      </section>

      <p className="flex items-center gap-1.5 text-xs text-gray-400"><RotateCcw className="h-3.5 w-3.5" /> {isTh ? 'ค่าที่แก้มีผลกับการคำนวณครั้งถัดไป (สร้างรอบเงินเดือน/คำนวณ SC ใหม่) — งวดที่ปิดไปแล้วไม่ถูกแตะ' : 'Changes apply to the NEXT calculation (payrun generate / SC recompute) — finalized periods are never touched'}</p>
      {dialog}
    </div>
  );
}
