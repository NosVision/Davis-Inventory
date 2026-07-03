'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal, ModalFooter, Input, Button, toast } from '@/components/ui';
import type { DaySummary } from '@/components/hr/timesheet-parts';

/** The day + employee an HR user chose to correct. */
export interface EditTarget {
  userId: string;
  name: string;
  day: DaySummary;
}

interface TimesheetEditModalProps {
  isOpen: boolean;
  target: EditTarget | null;
  /** Currently-selected store filter — sent as store_id on the override. */
  storeId: string;
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
 * HR-only edit form for a single derived timesheet day (§J8 / P2.4b). Layers an override
 * over the derived metrics via PUT /api/hr/timesheet/override (a reason is mandatory); an
 * already-overridden day can be reverted with DELETE. The punches are never modified.
 */
export function TimesheetEditModal({
  isOpen,
  target,
  storeId,
  onClose,
  onSaved,
}: TimesheetEditModalProps) {
  const t = useTranslations('hr.timesheet');

  const [worked, setWorked] = useState('');
  const [late, setLate] = useState('');
  const [ot, setOt] = useState('');
  const [absent, setAbsent] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Seed the form from the derived/merged values each time a day is opened.
  useEffect(() => {
    if (!isOpen || !target) return;
    const d = target.day;
    setWorked(minToHoursStr(d.worked_min));
    setLate(d.late_min == null ? '' : String(d.late_min));
    setOt(minToHoursStr(d.ot_min));
    setAbsent(d.absent);
    setReason('');
  }, [isOpen, target]);

  if (!target) return null;
  const busy = saving || clearing;

  const handleSave = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast({ type: 'warning', title: t('reasonRequired') });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/hr/timesheet/override', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          user_id: target.userId,
          business_date: target.day.business_date,
          store_id: storeId || undefined,
          worked_min: hoursStrToMin(worked),
          late_min: minStrToMin(late),
          ot_min: hoursStrToMin(ot),
          absent,
          reason: trimmed,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed'), message: json?.error });
        return;
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
      const res = await fetch(`/api/hr/timesheet/override?${qs.toString()}`, {
        method: 'DELETE',
      });
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('editDayTitle')}
      description={`${target.name} · ${target.day.business_date}`}
      size="md"
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
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
            value={ot}
            onChange={(e) => setOt(e.target.value)}
          />
          <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={absent}
              onChange={(e) => setAbsent(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
            />
            {t('absentToggle')}
          </label>
        </div>
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
  );
}
