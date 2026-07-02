'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Loader2 } from 'lucide-react';
import { Button, Badge, Modal, ModalFooter, EmptyState, toast } from '@/components/ui';
import {
  SignaturePad,
  type SignaturePadHandle,
} from '@/components/ui/signature-pad';

interface Policy {
  id: string;
  title: string;
  category: string | null;
  body: string | null;
  version: number;
  sort_order: number;
  acked: boolean;
}

export default function MyPoliciesPage() {
  const t = useTranslations('hr.ess');

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Policy | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const sigRef = useRef<SignaturePadHandle | null>(null);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/policies');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setPolicies((json.data ?? []) as Policy[]);
    } catch {
      toast({ type: 'error', title: t('loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const closeModal = useCallback(() => {
    setActive(null);
    setSubmitting(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!active) return;
    const pad = sigRef.current;
    if (!pad || pad.isEmpty()) {
      toast({ type: 'warning', title: t('signRequired') });
      return;
    }
    const signature = pad.toDataURL();
    if (!signature) {
      toast({ type: 'warning', title: t('signRequired') });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/hr/ess/policies/${active.id}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature }),
      });
      if (!res.ok) throw new Error('ack failed');
      toast({ type: 'success', title: t('ackedOk') });
      closeModal();
      await fetchPolicies();
    } catch {
      toast({ type: 'error', title: t('ackFailed') });
      setSubmitting(false);
    }
  }, [active, t, closeModal, fetchPolicies]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          {t('policiesTitle')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('policiesSubtitle')}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : policies.length === 0 ? (
        <EmptyState icon={FileText} title={t('empty')} />
      ) : (
        <ul className="space-y-3">
          {policies.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate font-semibold text-gray-900 dark:text-white">
                    {p.title}
                  </h2>
                  <Badge variant={p.acked ? 'success' : 'warning'} size="sm">
                    {p.acked ? t('acknowledged') : t('pending')}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {p.category ? `${p.category} · ` : ''}
                  {t('version')} {p.version}
                </p>
              </div>
              <Button
                variant={p.acked ? 'outline' : 'primary'}
                size="sm"
                className="shrink-0 self-start sm:self-auto"
                onClick={() => setActive(p)}
              >
                {p.acked ? t('read') : t('acknowledge')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={active !== null}
        onClose={closeModal}
        title={active?.title}
        description={
          active
            ? `${active.category ? `${active.category} · ` : ''}${t('version')} ${active.version}`
            : undefined
        }
        size="full"
      >
        {active && (
          <div className="space-y-4">
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              {active.body || '—'}
            </div>

            {!active.acked && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('signPrompt')}
                </p>
                <SignaturePad ref={sigRef} />
              </div>
            )}
          </div>
        )}

        <ModalFooter>
          {active && !active.acked ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => sigRef.current?.clear()}
                disabled={submitting}
              >
                {t('clear')}
              </Button>
              <Button size="sm" onClick={handleSubmit} isLoading={submitting}>
                {submitting ? t('submitting') : t('submit')}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={closeModal}>
              {t('close')}
            </Button>
          )}
        </ModalFooter>
      </Modal>
    </div>
  );
}
