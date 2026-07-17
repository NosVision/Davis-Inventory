'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Card, CardHeader, CardContent, Button, Input, toast } from '@/components/ui';
import { MessageCircle, Copy, Check, Loader2 } from 'lucide-react';

// Owner-only config for the CENTRAL task LINE bot (its own channel, separate from the per-store
// customer OAs). Token/secret are write-only from the client — the API never returns them, only
// whether each is set. Self-contained bilingual strings (matches the settings-page style).
export function TaskLineBotConfig() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? {
        title: 'บอท LINE สำหรับห้องงาน (บอทกลาง)',
        desc: 'บอทแยกเฉพาะระบบห้องงาน — คนละตัวกับ LINE OA ของสาขา (ลูกค้า)',
        status: 'สถานะ', set: 'ตั้งค่าแล้ว', unset: 'ยังไม่ตั้ง',
        token: 'Channel access token', secret: 'Channel secret',
        tokenPlaceholderSet: '•••• (ตั้งค่าไว้แล้ว — เว้นว่าง = ไม่เปลี่ยน)',
        tokenPlaceholder: 'วาง Channel access token',
        secretPlaceholderSet: '•••• (ตั้งค่าไว้แล้ว — เว้นว่าง = ไม่เปลี่ยน)',
        secretPlaceholder: 'วาง Channel secret',
        save: 'บันทึกบอทงาน', saved: 'บันทึกแล้ว', saveFail: 'บันทึกไม่สำเร็จ',
        webhook: 'Webhook URL (สำหรับบอทงาน)',
        webhookHint: 'นำ URL นี้ไปตั้งใน LINE Developers Console ของ "ช่องบอทงาน" (คนละช่องกับของสาขา)',
        copy: 'คัดลอก', copied: 'คัดลอกแล้ว',
        guideTitle: 'วิธีตั้งค่า',
        g1: 'สร้าง LINE Official Account / Messaging API ใหม่ 1 ตัวสำหรับงานโดยเฉพาะ',
        g2: 'ก็อป Channel access token + Channel secret มาวางด้านบน แล้วบันทึก',
        g3: 'วาง Webhook URL ข้างล่างใน Console ของช่องบอทงาน แล้วเปิด Use webhook',
        g4: 'เชิญบอทงานเข้ากลุ่ม LINE แล้วพิมพ์ "groupid" เพื่อเอา Group ID ไปตั้งในห้องงาน',
      }
    : {
        title: 'Task Room LINE bot (central)',
        desc: 'A dedicated bot for the Task Room system — separate from the per-store customer OAs',
        status: 'Status', set: 'Set', unset: 'Not set',
        token: 'Channel access token', secret: 'Channel secret',
        tokenPlaceholderSet: '•••• (already set — leave blank to keep)',
        tokenPlaceholder: 'Paste channel access token',
        secretPlaceholderSet: '•••• (already set — leave blank to keep)',
        secretPlaceholder: 'Paste channel secret',
        save: 'Save task bot', saved: 'Saved', saveFail: 'Failed to save',
        webhook: 'Webhook URL (task bot)',
        webhookHint: 'Set this URL in the LINE Developers Console of the "task bot" channel (not a store channel)',
        copy: 'Copy', copied: 'Copied',
        guideTitle: 'Setup',
        g1: 'Create a new LINE Official Account / Messaging API channel just for tasks',
        g2: 'Paste its Channel access token + Channel secret above and save',
        g3: 'Set the Webhook URL below in that channel\'s Console and enable Use webhook',
        g4: 'Invite the task bot to a LINE group and type "groupid" to get the Group ID for a room',
      };

  const [tokenSet, setTokenSet] = useState(false);
  const [secretSet, setSecretSet] = useState(false);
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/line/tasks/webhook` : '';

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks/line-config');
      if (!res.ok) return;
      const json = await res.json();
      setTokenSet(Boolean(json.token_set));
      setSecretSet(Boolean(json.secret_set));
    } catch {
      /* best-effort */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    // Only send non-empty fields (blank = keep existing).
    const payload: Record<string, string> = {};
    if (token.trim()) payload.token = token.trim();
    if (secret.trim()) payload.secret = secret.trim();
    if (Object.keys(payload).length === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tasks/line-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || L.saveFail);
      toast({ type: 'success', title: L.saved });
      setToken('');
      setSecret('');
      await load();
    } catch (e) {
      toast({ type: 'error', title: L.saveFail, message: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const copyWebhook = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const Dot = ({ ok }: { ok: boolean }) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
      {ok ? L.set : L.unset}
    </span>
  );

  return (
    <Card padding="none">
      <CardHeader
        title={L.title}
        description={L.desc}
        action={
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 dark:bg-green-900/20">
            <MessageCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
          </div>
        }
      />
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1.5">{L.token}: <Dot ok={tokenSet} /></span>
              <span className="flex items-center gap-1.5">{L.secret}: <Dot ok={secretSet} /></span>
            </div>

            <Input
              label={L.token}
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={tokenSet ? L.tokenPlaceholderSet : L.tokenPlaceholder}
              autoComplete="off"
            />
            <Input
              label={L.secret}
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={secretSet ? L.secretPlaceholderSet : L.secretPlaceholder}
              autoComplete="off"
            />
            <div className="flex justify-end">
              <Button onClick={save} isLoading={saving} disabled={!token.trim() && !secret.trim()}>{L.save}</Button>
            </div>

            {/* Task-bot webhook URL */}
            <div>
              <p className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-300">{L.webhook}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg bg-gray-100 px-3 py-2.5 text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200">{webhookUrl || '—'}</code>
                <button
                  onClick={copyWebhook}
                  disabled={!webhookUrl}
                  className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {copied ? <><Check className="h-3.5 w-3.5" />{L.copied}</> : <><Copy className="h-3.5 w-3.5" />{L.copy}</>}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-gray-400">{L.webhookHint}</p>
            </div>

            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800/50 dark:bg-green-900/20">
              <p className="mb-2 text-xs font-semibold text-green-900 dark:text-green-200">{L.guideTitle}</p>
              <ol className="ml-4 list-decimal space-y-1.5 text-xs text-green-800 dark:text-green-300">
                <li>{L.g1}</li>
                <li>{L.g2}</li>
                <li>{L.g3}</li>
                <li>{L.g4}</li>
              </ol>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
