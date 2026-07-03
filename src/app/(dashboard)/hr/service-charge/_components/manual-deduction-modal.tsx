'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal, ModalFooter, Input, Button, toast } from '@/components/ui';
import { bahtToSatang } from '@/lib/pos/money';

/** The allocation an HR user chose to add a manual deduction to. */
export interface ManualTarget {
  allocId: string;
  name: string;
}

interface ManualDeductionModalProps {
  target: ManualTarget | null;
  onClose: () => void;
  /** Called after a successful POST so the page can refetch. */
  onAdded: () => void;
}

/**
 * Adds a manual (auto=false) SC deduction line to one person's allocation via
 * POST /api/hr/service-charge/allocations/[allocId]/deductions. Amount is entered
 * in baht and converted to satang on submit.
 */
export function ManualDeductionModal({ target, onClose, onAdded }: ManualDeductionModalProps) {
  const t = useTranslations('hr.serviceCharge');

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset the form each time a new allocation is targeted.
  useEffect(() => {
    if (target) {
      setLabel('');
      setAmount('');
      setNote('');
    }
  }, [target]);

  if (!target) return null;

  const submit = async () => {
    const trimmedLabel = label.trim();
    const amt = Number(amount);
    if (!trimmedLabel) {
      toast({ type: 'warning', title: t('manualLabelRequired') });
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ type: 'warning', title: t('manualAmountRequired') });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/hr/service-charge/allocations/${target.allocId}/deductions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            label: trimmedLabel,
            amount_satang: bahtToSatang(amt),
            note: note.trim() || undefined,
          }),
        }
      );
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed'), message: json?.error });
        return;
      }
      toast({ type: 'success', title: t('deductionAdded') });
      onAdded();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={!!target}
      onClose={onClose}
      title={t('manualModalTitle')}
      description={target.name}
      size="md"
    >
      <div className="space-y-3">
        <Input
          label={t('manualLabel')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('manualLabelPlaceholder')}
        />
        <Input
          label={t('manualAmount')}
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          label={t('manualNote')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('manualNotePlaceholder')}
        />
      </div>
      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose} disabled={saving}>
          {t('cancel')}
        </Button>
        <Button type="button" onClick={submit} isLoading={saving} disabled={saving}>
          {t('addDeduction')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
