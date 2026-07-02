'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal, ModalFooter, Select, Textarea, Input, Button, toast } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

interface RefOpt {
  value: string;
  label: string;
}

interface TransferModalProps {
  isOpen: boolean;
  employeeId: string | null;
  currentCompanyId: string | null;
  currentCompanyName?: string | null;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Company-transfer flow (§A). Separate from the edit form because a company change
 * must go through POST /api/hr/employees/[id]/transfer (mandatory reason + audit),
 * not the generic PUT (which rejects company_id).
 */
export function TransferModal({
  isOpen,
  employeeId,
  currentCompanyId,
  currentCompanyName,
  onClose,
  onDone,
}: TransferModalProps) {
  const t = useTranslations('hr.employees.transfer');
  const tf = useTranslations('hr.employees.form');

  const [companies, setCompanies] = useState<RefOpt[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCompanyId('');
    setReason('');
    setEffectiveDate('');
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from('hr_companies')
        .select('id, name')
        .eq('active', true)
        .order('name');
      setCompanies(
        (data ?? [])
          .filter((c) => c.id !== currentCompanyId)
          .map((c) => ({ value: c.id as string, label: c.name as string }))
      );
    })();
  }, [isOpen, currentCompanyId]);

  const submit = async () => {
    if (!companyId) {
      toast({ type: 'error', title: t('requiredTarget') });
      return;
    }
    if (!reason.trim()) {
      toast({ type: 'error', title: t('requiredReason') });
      return;
    }
    if (!employeeId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/transfer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          reason: reason.trim(),
          effective_date: effectiveDate || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ type: 'error', title: t('failed'), message: json?.error });
        return;
      }
      toast({ type: 'success', title: t('success') });
      onDone();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('title')} size="sm">
      <div className="space-y-3">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t('current')}:{' '}
          <span className="font-medium text-gray-900 dark:text-white">
            {currentCompanyName || '—'}
          </span>
        </div>
        <Select
          label={t('target')}
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          placeholder={t('target')}
          options={companies}
        />
        <Input
          type="date"
          label={t('effectiveDate')}
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
        />
        <Textarea
          label={t('reason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} type="button">
          {tf('cancel')}
        </Button>
        <Button onClick={submit} isLoading={submitting} type="button">
          {submitting ? t('submitting') : t('submit')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
