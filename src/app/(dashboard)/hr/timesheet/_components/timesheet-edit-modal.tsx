'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { User } from 'lucide-react';
import { Modal, ModalFooter, Input, Button, toast, usePromptDialog } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import type { DaySummary } from '@/components/hr/timesheet-parts';

/** A leave type the HR user may assign from the day-edit modal. */
export interface LeaveTypeOption {
  id: string;
  code: string;
  name_th: string | null;
  name_en: string | null;
  company_id: string | null;
}

/** The day + employee an HR user chose to correct. */
export interface EditTarget {
  userId: string;
  name: string;
  companyId: string | null; // the employee's company — scopes the leave-type options
  /** hr_employees.ot_eligible — when false the payroll engine pays 0 OT no matter what is stored here. */
  otEligible: boolean;
  /** hr_employees.pay_type — day-rated staff are paid worked_days × rate, so an hours-less
   *  "present" day silently costs them a day's wage. */
  payType: string | null;
  day: DaySummary;
}

type DayStatusChoice = 'present' | 'absent' | 'leave';

/**
 * Pay types whose base is built from recorded time (payroll.ts computeBaseSalary): pt_daily and
 * pt_monthly multiply worked_days, pt_hourly multiplies the summed worked minutes. All three lose
 * real money when a day records none. Only full_monthly is flat and therefore unaffected.
 */
const TIME_PAID = new Set(['pt_daily', 'pt_monthly', 'pt_hourly']);

interface TimesheetEditModalProps {
  isOpen: boolean;
  target: EditTarget | null;
  /** Currently-selected store filter — sent as store_id on the override / leave. */
  storeId: string;
  /** Active leave types (from the timesheet payload); filtered to the employee's company here. */
  leaveTypes: LeaveTypeOption[];
  onClose: () => void;
  /** Called after a successful save/clear so the page can refetch. */
  onSaved: () => void;
}

/** Minutes → a clean hours string (e.g. 540 → "9", 545 → "9.08", null → ""). */
function minToHoursStr(min: number | null): string {
  if (min == null) return '';
  return String(Math.round((min / 60) * 100) / 100);
}
/** Hours string → non-negative integer minutes, or null when blank/invalid (clears field). */
function hoursStrToMin(v: string): number | null {
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n * 60));
}
/** Minutes string → non-negative integer minutes, or null when blank/invalid. */
function minStrToMin(v: string): number | null {
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

/**
 * HR-only edit form for a single derived timesheet day (§J8 / P2.4b). Beyond the raw metric
 * override (worked/late/OT via PUT /api/hr/timesheet/override), HR sets the day's STATUS:
 *   • present / absent → the `absent` flag on the override (a reason is mandatory).
 *   • leave            → creates an approved single-day leave (POST /api/hr/leaves) so payroll
 *                        "covers" the day instead of docking it as an unauthorised absence.
 * Switching a leave day back to present/absent cancels the leave first. The employee name is
 * shown prominently so HR knows whose backdated day they're editing (owner ask 2026-07-10).
 */
export function TimesheetEditModal({
  isOpen,
  target,
  storeId,
  leaveTypes,
  onClose,
  onSaved,
}: TimesheetEditModalProps) {
  const t = useTranslations('hr.timesheet');
  const { prompt, dialog: promptDialog } = usePromptDialog();
  const isTh = useLocale() === 'th';

  const [status, setStatus] = useState<DayStatusChoice>('present');
  const [worked, setWorked] = useState('');
  const [late, setLate] = useState('');
  const [ot, setOt] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Leave types available to THIS employee: shared (null company) + their own company.
  const availableTypes = useMemo(
    () => leaveTypes.filter((lt) => lt.company_id === null || lt.company_id === target?.companyId),
    [leaveTypes, target?.companyId]
  );
  const typeName = (lt: LeaveTypeOption) => (isTh ? lt.name_th : lt.name_en) || lt.code;

  // Seed the form from the derived/merged values each time a day is opened.
  useEffect(() => {
    if (!isOpen || !target) return;
    const d = target.day;
    setWorked(minToHoursStr(d.worked_min));
    setLate(d.late_min == null ? '' : String(d.late_min));
    setOt(minToHoursStr(d.ot_min));
    setReason('');
    if (d.leave) {
      setStatus('leave');
      const match = leaveTypes.find(
        (lt) => lt.code === d.leave!.code && (lt.company_id === null || lt.company_id === target.companyId)
      );
      setLeaveTypeId(match?.id ?? '');
    } else {
      setStatus(d.absent ? 'absent' : 'present');
      setLeaveTypeId('');
    }
  }, [isOpen, target, leaveTypes]);

  if (!target) return null;
  const busy = saving || clearing;
  const existingLeaveId = target.day.leave?.id ?? null;
  const existingLeaveCode = target.day.leave?.code ?? null;

  const STATUS_OPTIONS: { key: DayStatusChoice; label: string; active: string }[] = [
    { key: 'present', label: t('statusPresent'), active: 'bg-emerald-500 text-white ring-emerald-500' },
    { key: 'absent', label: t('statusAbsent'), active: 'bg-red-500 text-white ring-red-500' },
    { key: 'leave', label: t('statusLeave'), active: 'bg-violet-500 text-white ring-violet-500' },
  ];

  const handleSave = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast({ type: 'warning', title: t('reasonRequired') });
      return;
    }
    if (status === 'leave' && !leaveTypeId) {
      toast({ type: 'warning', title: t('selectLeaveTypeRequired') });
      return;
    }
    // "Present" with the hours box left blank writes absent=false and worked_min=null, so the day
    // counts as neither worked nor absent — it vanishes from both totals with nothing to say so.
    //
    // Refused outright on a day that was clocked in but never out. That day has no computable hours
    // to begin with, and saving it "present" with none entered is precisely how four days in one
    // August cycle ended up crediting zero hours and zero OT (client 2026-08-20: "ถ้ามากดเช็คอิน
    // แต่ไม่กดเช็คเอ้าต้องไม่ให้บันทึก"). HR must put the real hours in, or call the day absent or
    // leave — anything definite.
    //
    // Refused too on any time-paid contract, where an hours-less day silently costs a day's wage.
    // Elsewhere (flat monthly) it only misleads, so it warns and saves.
    if (status === 'present' && hoursStrToMin(worked) == null) {
      const clockedInNeverOut = !!target?.day.first_in && !target.day.last_out;
      if (clockedInNeverOut) {
        toast({ type: 'error', title: t('missingClockOutNeedsHours') });
        return;
      }
      if (TIME_PAID.has(target?.payType ?? '')) {
        toast({ type: 'error', title: t('presentNeedsHours') });
        return;
      }
      toast({ type: 'warning', title: t('presentNoHoursHint') });
    }
    setSaving(true);
    try {
      if (status === 'leave') {
        const selected = availableTypes.find((lt) => lt.id === leaveTypeId);
        const sameAsExisting = !!existingLeaveId && !!selected && selected.code === existingLeaveCode;
        if (!sameAsExisting) {
          // Replace any existing leave (e.g. a type change) before creating the new one.
          if (existingLeaveId) {
            const del = await fetch(`/api/hr/leaves/${existingLeaveId}`, { method: 'DELETE' });
            if (!del.ok) {
              const j = (await del.json().catch(() => ({}))) as { error?: string };
              toast({ type: 'error', title: t('saveFailed'), message: j?.error });
              return;
            }
          }
          const postLeave = (override?: string) =>
            fetch('/api/hr/leaves', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                user_id: target.userId,
                store_id: storeId || undefined,
                leave_type_id: leaveTypeId,
                from_date: target.day.business_date,
                to_date: target.day.business_date,
                reason: trimmed,
                ...(override ? { override_quota: true, override_reason: override } : {}),
              }),
            });

          let res = await postLeave();
          // Over quota is HR's call, not a wall — otherwise marking a leave day for someone whose
          // quota is spent (three people are set to 0 days) would be impossible from here, and the
          // day would silently stay unmarked.
          if (res.status === 409) {
            const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
            if (j?.code !== 'quota_exceeded') {
              toast({ type: 'error', title: t('saveFailed'), message: j?.error });
              return;
            }
            const why = await prompt({
              title: 'เกินโควตา — ยืนยันบันทึก?',
              message: `${j.error}

ระบุเหตุผลที่ให้เกินโควตา (บันทึกไว้ในประวัติ)`,
              confirmLabel: 'ยืนยันบันทึก',
            });
            if (!why || !why.trim()) return;
            res = await postLeave(why.trim());
          }
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            toast({ type: 'error', title: t('saveFailed'), message: j?.error });
            return;
          }
        }
      } else {
        // present / absent — drop any leave that used to cover the day, then write the override.
        if (existingLeaveId) {
          const del = await fetch(`/api/hr/leaves/${existingLeaveId}`, { method: 'DELETE' });
          if (!del.ok) {
            const j = (await del.json().catch(() => ({}))) as { error?: string };
            toast({ type: 'error', title: t('saveFailed'), message: j?.error });
            return;
          }
        }
        const res = await fetch('/api/hr/timesheet/override', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            user_id: target.userId,
            business_date: target.day.business_date,
            store_id: storeId || undefined,
            worked_min: hoursStrToMin(worked),
            late_min: minStrToMin(late),
            // Never persist OT for an OT-ineligible employee — payroll would drop it anyway.
            ot_min: target.otEligible ? hoursStrToMin(ot) : null,
            absent: status === 'absent',
            reason: trimmed,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          toast({ type: 'error', title: t('saveFailed'), message: j?.error });
          return;
        }
      }
      toast({ type: 'success', title: t('saved') });
      onSaved();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      const qs = new URLSearchParams({
        user_id: target.userId,
        business_date: target.day.business_date,
      });
      const res = await fetch(`/api/hr/timesheet/override?${qs.toString()}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed'), message: json?.error });
        return;
      }
      toast({ type: 'success', title: t('cleared') });
      onSaved();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
    <Modal isOpen={isOpen} onClose={onClose} title={t('editDayTitle')} size="md">
      <div className="space-y-4">
        {/* Whose day is being edited — prominent so backdated manual entries aren't mis-filed. */}
        <div className="flex items-center gap-2.5 rounded-lg bg-indigo-50 px-3 py-2 dark:bg-indigo-900/20">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
            <User className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{target.name}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('editingLabel')} · {target.day.business_date}
            </p>
          </div>
        </div>

        {/* Day status: present / absent / leave */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">{t('statusLabel')}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setStatus(o.key)}
                className={cn(
                  'rounded-lg px-2 py-2 text-sm font-medium ring-1 transition-colors',
                  status === o.key
                    ? o.active
                    : 'bg-gray-50 text-gray-600 ring-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-gray-700'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {status === 'leave' ? (
          availableTypes.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              {t('noLeaveTypes')}
            </p>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                {t('leaveTypeLabel')}
              </label>
              <select
                value={leaveTypeId}
                onChange={(e) => setLeaveTypeId(e.target.value)}
                className="control w-full"
              >
                <option value="">{t('selectLeaveType')}</option>
                {availableTypes.map((lt) => (
                  <option key={lt.id} value={lt.id}>
                    {typeName(lt)}
                  </option>
                ))}
              </select>
            </div>
          )
        ) : (
          <>
            {/* Say it before the save is refused, not after. */}
            {status === 'present' && !!target?.day.first_in && !target.day.last_out && (
              <p className="mb-2 rounded-md bg-orange-50 px-3 py-2 text-xs text-orange-800 dark:bg-orange-900/30 dark:text-orange-200">
                {t('missingClockOutNotice', { at: target.day.first_in.slice(11, 16) })}
              </p>
            )}
          <div className="grid grid-cols-3 gap-3">
            <Input
              label={t('worked')}
              type="number"
              inputMode="decimal"
              min={0}
              step={0.25}
              value={worked}
              onChange={(e) => setWorked(e.target.value)}
            />
            <Input
              label={t('lateMin')}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={late}
              onChange={(e) => setLate(e.target.value)}
            />
            <Input
              label={t('ot')}
              type="number"
              inputMode="decimal"
              min={0}
              step={0.25}
              value={target.otEligible ? ot : ''}
              disabled={!target.otEligible}
              onChange={(e) => setOt(e.target.value)}
            />
          </div>
          </>
        )}

        {/* payroll.ts pays 0 OT unless hr_employees.ot_eligible is on. Without this the field
            accepted a number, the timesheet showed it, and the payslip silently dropped it. */}
        {status !== 'leave' && !target.otEligible && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            {t('otNotEligible')}
          </p>
        )}

        <Input
          label={t('reason')}
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('reason')}
        />
      </div>
      <ModalFooter>
        {target.day.overridden && (
          <Button
            variant="ghost"
            onClick={handleClear}
            isLoading={clearing}
            disabled={busy}
            type="button"
            className="mr-auto text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            {t('clearOverride')}
          </Button>
        )}
        <Button variant="outline" onClick={onClose} type="button" disabled={busy}>
          {t('close')}
        </Button>
        <Button onClick={handleSave} isLoading={saving} disabled={busy} type="button">
          {saving ? t('saving') : t('save')}
        </Button>
      </ModalFooter>
    </Modal>
    {promptDialog}
    </>
  );
}
