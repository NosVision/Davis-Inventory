'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui';
import { RecurringGrid } from './_components/recurring-grid';

// /hr/payroll/recurring — standalone page for the company-wide recurring-items grid.
// The same grid also opens as a modal on /hr/payroll; all logic lives in RecurringGrid.
export default function RecurringGridPage() {
  const t = useTranslations('hr.payroll.recurringPage');
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6 2xl:max-w-[96rem]">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <RecurringGrid />
    </div>
  );
}
