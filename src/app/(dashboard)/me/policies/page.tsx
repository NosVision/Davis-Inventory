'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { FileText, Loader2, CheckCircle2, Clock, ArrowDown, ShieldCheck } from 'lucide-react';
import {
  Button,
  Modal,
  ModalFooter,
  EmptyState,
  PageHeader,
  StatusBadge,
  DataList,
  DataCard,
  toast,
} from '@/components/ui';
import { PolicyMarkdown } from '@/components/hr/policy-markdown';
import { formatThaiDateTime } from '@/lib/utils/format';

interface Policy {
  id: string;
  title: string;
  category: string | null;
  body: string | null;
  version: number;
  sort_order: number;
  acked: boolean;
  acked_at?: string | null;
}

// Employee self-service policy reader (owner ask 2026-07-08). Every linked employee must READ the
// company handbook, scroll to the very bottom, tick "accept", then save — the acknowledgement is
// stored per policy VERSION (a version bump forces a fresh read + accept). Rendered as rich Markdown
// so the handbook is readable on phones and desktop alike; no drawn signature required.
export default function MyPoliciesPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? {
        title: 'ระเบียบบริษัท',
        subtitle: 'อ่านและกดยอมรับระเบียบพนักงาน — ระบบจะบันทึกไว้ตามเวอร์ชัน',
        empty: 'ยังไม่มีระเบียบให้อ่าน',
        version: 'เวอร์ชัน',
        acknowledged: 'ยอมรับแล้ว',
        pending: 'ต้องอ่าน/ยอมรับ',
        read: 'อ่านอีกครั้ง',
        acknowledge: 'อ่านและยอมรับ',
        scrollHint: 'กรุณาเลื่อนอ่านให้ถึงด้านล่างสุดก่อนจึงจะกดยอมรับได้',
        accept:
          'ข้าพเจ้าได้อ่าน ทำความเข้าใจ และยินยอมปฏิบัติตามระเบียบฉบับนี้ทุกประการ',
        save: 'ยอมรับและบันทึก',
        submitting: 'กำลังบันทึก…',
        close: 'ปิด',
        ackedOn: 'ยอมรับเมื่อ',
        okTitle: 'บันทึกการยอมรับแล้ว',
        failTitle: 'บันทึกไม่สำเร็จ',
        loadFail: 'โหลดไม่สำเร็จ',
      }
    : {
        title: 'Company policies',
        subtitle: 'Read and accept the staff handbook — stored per version',
        empty: 'No policies to read yet',
        version: 'Version',
        acknowledged: 'Accepted',
        pending: 'Must read & accept',
        read: 'Read again',
        acknowledge: 'Read & accept',
        scrollHint: 'Please scroll to the very bottom before you can accept',
        accept: 'I have read, understood, and agree to comply with this policy in full',
        save: 'Accept & save',
        submitting: 'Saving…',
        close: 'Close',
        ackedOn: 'Accepted on',
        okTitle: 'Acknowledgement saved',
        failTitle: 'Save failed',
        loadFail: 'Load failed',
      };

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Policy | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/policies');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setPolicies((json.data ?? []) as Policy[]);
    } catch {
      toast({ type: 'error', title: L.loadFail });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const openPolicy = (p: Policy) => {
    setActive(p);
    setAccepted(false);
    // An already-accepted policy (read mode) needs no scroll gate; a pending one starts locked
    // and unlocks either when the reader scrolls to the bottom or when the text already fits.
    setReachedEnd(p.acked);
  };

  const closeModal = useCallback(() => {
    setActive(null);
    setSubmitting(false);
    setReachedEnd(false);
    setAccepted(false);
  }, []);

  // When the body already fits without scrolling, there is nothing to scroll — unlock immediately.
  useEffect(() => {
    if (!active || active.acked) return;
    const el = scrollRef.current;
    if (el && el.scrollHeight - el.clientHeight <= 8) setReachedEnd(true);
  }, [active]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) setReachedEnd(true);
  };

  const handleSubmit = useCallback(async () => {
    if (!active || !accepted) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/hr/ess/policies/${active.id}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true }),
      });
      if (!res.ok) throw new Error('ack failed');
      toast({ type: 'success', title: L.okTitle });
      closeModal();
      await fetchPolicies();
    } catch {
      toast({ type: 'error', title: L.failTitle });
      setSubmitting(false);
    }
  }, [active, accepted, L.okTitle, L.failTitle, closeModal, fetchPolicies]);

  const pendingCount = policies.filter((p) => !p.acked).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageHeader title={L.title} subtitle={L.subtitle} />

      {!loading && pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
          <Clock className="h-4 w-4 shrink-0" />
          {isTh
            ? `มีระเบียบ ${pendingCount} ฉบับที่ต้องอ่านและกดยอมรับ`
            : `${pendingCount} polic${pendingCount > 1 ? 'ies' : 'y'} to read and accept`}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : policies.length === 0 ? (
        <EmptyState icon={FileText} title={L.empty} />
      ) : (
        <DataList>
          {policies.map((p) => (
            <DataCard
              key={p.id}
              accent={p.acked ? 'good' : 'warn'}
              title={p.title}
              status={
                <StatusBadge
                  tone={p.acked ? 'good' : 'warn'}
                  icon={p.acked ? CheckCircle2 : Clock}
                  label={p.acked ? L.acknowledged : L.pending}
                />
              }
              actions={
                <Button
                  variant={p.acked ? 'outline' : 'primary'}
                  size="sm"
                  onClick={() => openPolicy(p)}
                >
                  {p.acked ? L.read : L.acknowledge}
                </Button>
              }
            >
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                {p.category ? <span>{p.category}</span> : null}
                <span>· {L.version} {p.version}</span>
                {p.acked && p.acked_at ? (
                  <span>· {L.ackedOn} {formatThaiDateTime(p.acked_at)}</span>
                ) : null}
              </div>
            </DataCard>
          ))}
        </DataList>
      )}

      <Modal
        isOpen={active !== null}
        onClose={closeModal}
        title={active?.title}
        description={
          active
            ? `${active.category ? `${active.category} · ` : ''}${L.version} ${active.version}`
            : undefined
        }
        size="full"
      >
        {active && (
          <div className="space-y-3">
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="max-h-[56vh] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-gray-50/40 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40"
            >
              {active.body ? <PolicyMarkdown source={active.body} /> : <span>—</span>}
            </div>

            {!active.acked && (
              <div className="space-y-2">
                {!reachedEnd && (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                    <ArrowDown className="h-3.5 w-3.5" />
                    {L.scrollHint}
                  </p>
                )}
                <label
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm transition-colors ${
                    reachedEnd
                      ? 'border-emerald-300 bg-emerald-50/60 text-gray-800 dark:border-emerald-700/60 dark:bg-emerald-900/15 dark:text-gray-100'
                      : 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-500'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={accepted}
                    disabled={!reachedEnd}
                    onChange={(e) => setAccepted(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800"
                  />
                  <span className="leading-relaxed">{L.accept}</span>
                </label>
              </div>
            )}
          </div>
        )}

        <ModalFooter>
          {active && !active.acked ? (
            <Button
              size="sm"
              onClick={handleSubmit}
              isLoading={submitting}
              disabled={!accepted || submitting}
            >
              <ShieldCheck className="h-4 w-4" />
              {submitting ? L.submitting : L.save}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={closeModal}>
              {L.close}
            </Button>
          )}
        </ModalFooter>
      </Modal>
    </div>
  );
}
