'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ShieldCheck } from 'lucide-react';
import { Button, Modal, ModalFooter, toast } from '@/components/ui';
import { useEssText } from '@/lib/i18n/ess-locale';
import { PolicyMarkdown } from './policy-markdown';

export interface ReaderPolicy {
  id: string;
  title: string;
  category: string | null;
  body: string | null;
  version: number;
  acked: boolean;
}

// Shared policy reader (owner ask 2026-07-08): render the policy body as rich Markdown, require the
// reader to scroll to the very bottom, tick "accept", then save — the acknowledgement is stored per
// version. Reused by the /me/policies list and by the app-wide PolicyGate that auto-prompts linked
// employees on any page. A closed (acked) policy opens read-only with no accept gate.
export function PolicyReaderModal({
  policy,
  onClose,
  onAcked,
}: {
  policy: ReaderPolicy | null;
  onClose: () => void;
  onAcked: () => void;
}) {
  const tx = useEssText();
  const L = {
    version: tx('เวอร์ชัน', 'Version', 'ဗားရှင်း', 'ເວີຊັນ'),
    scrollHint: tx(
      'กรุณาเลื่อนอ่านให้ถึงด้านล่างสุดก่อนจึงจะกดยอมรับได้',
      'Please scroll to the very bottom before you can accept',
      'လက်ခံနိုင်ရန် အောက်ဆုံးအထိ ဆွဲဖတ်ပါ',
      'ກະລຸນາເລື່ອນອ່ານໃຫ້ຮອດລຸ່ມສຸດກ່ອນຈຶ່ງກົດຍອມຮັບໄດ້'
    ),
    accept: tx(
      'ข้าพเจ้าได้อ่าน ทำความเข้าใจ และยินยอมปฏิบัติตามระเบียบฉบับนี้ทุกประการ',
      'I have read, understood, and agree to comply with this policy in full',
      'ကျွန်ုပ်သည် ဤစည်းမျဉ်းကို ဖတ်ရှုနားလည်ပြီး အပြည့်အဝ လိုက်နာရန် သဘောတူပါသည်',
      'ຂ້າພະເຈົ້າໄດ້ອ່ານ ເຂົ້າໃຈ ແລະ ຍິນຍອມປະຕິບັດຕາມລະບຽບສະບັບນີ້ທຸກປະການ'
    ),
    save: tx('ยอมรับและบันทึก', 'Accept & save', 'လက်ခံပြီး သိမ်းရန်', 'ຍອມຮັບ ແລະ ບັນທຶກ'),
    submitting: tx('กำลังบันทึก…', 'Saving…', 'သိမ်းနေသည်…', 'ກຳລັງບັນທຶກ…'),
    close: tx('ปิด', 'Close', 'ပိတ်', 'ປິດ'),
    okTitle: tx('บันทึกการยอมรับแล้ว', 'Acknowledgement saved', 'လက်ခံမှု သိမ်းပြီးပါပြီ', 'ບັນທຶກການຍອມຮັບແລ້ວ'),
    failTitle: tx('บันทึกไม่สำเร็จ', 'Save failed', 'သိမ်း၍မရပါ', 'ບັນທຶກບໍ່ສຳເລັດ'),
  };

  const [submitting, setSubmitting] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!policy) return;
    setSubmitting(false);
    setAccepted(false);
    // Already-accepted policies open read-only; a pending one starts locked until scrolled through.
    setReachedEnd(policy.acked);
  }, [policy]);

  // If the body already fits without scrolling, there's nothing to scroll — unlock immediately.
  useEffect(() => {
    if (!policy || policy.acked) return;
    const el = scrollRef.current;
    if (el && el.scrollHeight - el.clientHeight <= 8) setReachedEnd(true);
  }, [policy]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) setReachedEnd(true);
  };

  const submit = useCallback(async () => {
    if (!policy || !accepted) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/hr/ess/policies/${policy.id}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true }),
      });
      if (!res.ok) throw new Error('ack failed');
      toast({ type: 'success', title: L.okTitle });
      onAcked();
    } catch {
      toast({ type: 'error', title: L.failTitle });
      setSubmitting(false);
    }
  }, [policy, accepted, L.okTitle, L.failTitle, onAcked]);

  return (
    <Modal
      isOpen={policy !== null}
      onClose={onClose}
      title={policy?.title}
      description={
        policy ? `${policy.category ? `${policy.category} · ` : ''}${L.version} ${policy.version}` : undefined
      }
      size="full"
    >
      {policy && (
        <div className="space-y-3">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="max-h-[56vh] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-gray-50/40 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40"
          >
            {policy.body ? <PolicyMarkdown source={policy.body} /> : <span>—</span>}
          </div>

          {!policy.acked && (
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
        {policy && !policy.acked ? (
          <Button size="sm" onClick={submit} isLoading={submitting} disabled={!accepted || submitting}>
            <ShieldCheck className="h-4 w-4" />
            {submitting ? L.submitting : L.save}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onClose}>
            {L.close}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
