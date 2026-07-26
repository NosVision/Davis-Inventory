'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Badge,
  Card,
  Modal,
  ModalFooter,
  Select,
  Textarea,
  EmptyState,
  toast,
} from '@/components/ui';
import { ROLE_LABELS } from '@/types/roles';
import type { UserRole } from '@/types/roles';
import { formatThaiDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { Loader2, Copy, Link2, Trash2, Send, Plus, Mail, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

/**
 * ลิงก์รับพนักงาน — the third tab of /hr/employees (2026-07-27), merging the two onboarding
 * links that used to hide in different corners (ลิงก์สมัคร button on the employees tab, and
 * the /users/invitations page). The two selector cards double as the explainer: they spell
 * out how the link types differ so HR picks the right one instead of guessing.
 *
 *  - ลิงก์สมัครเอง (self-register): ONE shared link → account lands as สิทธิ์ระบบ "ยังไม่ระบุ",
 *    no store; HR verifies identity + assigns the role afterwards.
 *  - ลิงก์เชิญ (invite): many links, each pre-locked to a สิทธิ์ระบบ + สาขา; the account is
 *    usable the moment they finish signing up.
 */

type LinkSubTab = 'register' | 'invite';

export function InviteLinksManager() {
  const [sub, setSub] = useState<LinkSubTab>('register');

  const cards: { key: LinkSubTab; icon: typeof Link2; title: string; points: string[] }[] = [
    {
      key: 'register',
      icon: Link2,
      title: 'ลิงก์สมัครเอง (Self-register)',
      points: [
        'ลิงก์กลาง 1 ลิงก์ ใช้ร่วมกันได้ทุกคน',
        'สมัครแล้วได้สิทธิ์ระบบ "ยังไม่ระบุ" — ยังเปิดเมนูงานไม่ได้',
        'HR ต้องมายืนยันตัวตน + กำหนดสิทธิ์ระบบทีหลัง',
        'เหมาะกับรับพนักงานใหม่ทีละหลายคน',
      ],
    },
    {
      key: 'invite',
      icon: Mail,
      title: 'ลิงก์เชิญ (กำหนดสิทธิ์ล่วงหน้า)',
      points: [
        'สร้างได้หลายลิงก์ แยกตามงานที่จะรับ',
        'แต่ละลิงก์ล็อกสิทธิ์ระบบ + สาขาไว้แล้ว',
        'สมัครเสร็จใช้งานได้ทันที ไม่ต้องรอ HR กำหนดสิทธิ์',
        'เหมาะกับเชิญรายคนหรือรับตำแหน่งเฉพาะ',
      ],
    },
  ];

  return (
    <div className="space-y-4">
      {/* Selector cards = difference explainer (click to switch) */}
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map(({ key, icon: Icon, title, points }) => {
          const active = sub === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSub(key)}
              aria-pressed={active}
              className={cn(
                'rounded-xl border p-4 text-left transition-colors',
                active
                  ? 'border-teal-400 bg-teal-50/60 ring-1 ring-teal-300 dark:border-teal-700 dark:bg-teal-900/15 dark:ring-teal-800'
                  : 'border-gray-200 bg-white hover:border-teal-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-teal-800'
              )}
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg',
                    active
                      ? 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
              </div>
              <ul className="ml-4 list-disc space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                {points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {sub === 'register' ? <RegistrationLinkPanel /> : <InvitationsPanel />}
    </div>
  );
}

/* ── ลิงก์สมัครเอง ─────────────────────────────────────────────────────────────
 * Inline version of the old RegistrationLinkModal (owner ask 2026-07-10). Mint one
 * reusable link that new hires open to self-onboard (→ role 'not_assign' + an
 * hr_employees record). Exactly one active link. */

interface RegLinkInfo {
  url: string;
  expires_at: string;
  used_count: number;
}

function RegistrationLinkPanel() {
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<RegLinkInfo | null>(null);
  const [busy, setBusy] = useState(false);

  // Same no-sync-setState pattern as InvitationsPanel: loading starts true, flips off once.
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/registration-link');
      const j = await res.json().catch(() => ({}));
      setLink(res.ok ? ((j.data ?? null) as RegLinkInfo | null) : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/hr/registration-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ type: 'error', title: 'สร้างลิงก์ไม่สำเร็จ', message: j?.error }); return; }
      await load();
      toast({ type: 'success', title: 'สร้างลิงก์ใหม่แล้ว' });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm('ยกเลิกลิงก์นี้? ลิงก์เดิมจะใช้สมัครไม่ได้อีก')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/hr/registration-link', { method: 'DELETE' });
      if (!res.ok) { toast({ type: 'error', title: 'ยกเลิกไม่สำเร็จ' }); return; }
      setLink(null);
      toast({ type: 'success', title: 'ยกเลิกลิงก์แล้ว' });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast({ type: 'success', title: 'คัดลอกลิงก์แล้ว' });
    } catch {
      toast({ type: 'error', title: 'คัดลอกไม่สำเร็จ' });
    }
  };

  return (
    <Card>
      <div className="space-y-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          ส่งลิงก์นี้ให้พนักงานใหม่สมัครเอง — ตั้งชื่อผู้ใช้/รหัสผ่าน + เลือกชื่อจากข้อมูลนำเข้า (หรือกรอกเอง)
          ระบบจะสร้างบัญชีให้ทันที สิทธิ์เริ่มต้นเป็น &quot;ยังไม่ระบุ&quot; แล้ว HR ค่อยยืนยันตัวตนและกำหนดสิทธิ์ระบบทีหลัง
        </p>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
        ) : link ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input readOnly value={link.url} onFocus={(e) => e.target.select()} className="control w-full text-xs" />
              <Button size="sm" icon={<Copy className="h-4 w-4" />} onClick={copy}>คัดลอก</Button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              <span>สมัครแล้ว: <b className="text-gray-800 dark:text-gray-200">{link.used_count}</b> คน</span>
              <span>หมดอายุ: {new Date(link.expires_at).toLocaleDateString('th-TH')}</span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 py-6 text-center text-sm text-gray-400 dark:border-gray-600">
            <Link2 className="mx-auto mb-1 h-6 w-6 text-gray-300 dark:text-gray-600" />
            ยังไม่มีลิงก์ — กด &quot;สร้างลิงก์&quot; เพื่อเริ่ม
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
          {link && (
            <Button variant="ghost" onClick={revoke} disabled={busy} className="mr-auto text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20" icon={<Trash2 className="h-4 w-4" />}>
              ยกเลิกลิงก์
            </Button>
          )}
          <Button onClick={create} isLoading={busy} icon={<Send className="h-4 w-4" />}>
            {link ? 'สร้างลิงก์ใหม่' : 'สร้างลิงก์'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ── ลิงก์เชิญ ────────────────────────────────────────────────────────────────
 * Formerly the standalone /users/invitations page — each link pre-binds a สิทธิ์ระบบ
 * (Role) + สาขา so the sign-up is usable immediately. */

interface Invitation {
  id: string;
  token: string;
  store_id: string;
  role: UserRole;
  active: boolean;
  used_count: number;
  notes: string | null;
  created_at: string;
  store: { store_name: string; store_code: string } | null;
  creator: { display_name: string | null; username: string } | null;
}

interface StoreOption {
  id: string;
  store_name: string;
}

const INVITABLE_ROLES: UserRole[] = ['accountant', 'manager', 'bar', 'head_bar', 'technician', 'staff', 'hq', 'hr'];

function InvitationsPanel() {
  const [items, setItems] = useState<Invitation[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const [formStoreId, setFormStoreId] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('staff');
  const [formNotes, setFormNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // isLoading starts true and only flips off — reloads after create/toggle/delete keep the
  // table on screen instead of flashing the spinner (also keeps setState out of effect bodies).
  const load = useCallback(async () => {
    const res = await fetch('/api/users/invitations');
    const data = await res.json();
    if (res.ok) setItems(data.invitations || []);
    else toast({ type: 'error', title: 'โหลดข้อมูลไม่สำเร็จ', message: data.error });
    setIsLoading(false);
  }, []);

  const loadStores = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('stores')
      .select('id, store_name')
      .eq('active', true)
      .order('store_name');
    if (data) {
      setStores(data);
      if (data[0] && !formStoreId) setFormStoreId(data[0].id);
    }
  }, [formStoreId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; every setState runs after an await, not synchronously
    load();
    loadStores();
  }, [load, loadStores]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formStoreId || !formRole) return;
    setIsSubmitting(true);
    const res = await fetch('/api/users/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: formStoreId, role: formRole, notes: formNotes }),
    });
    const data = await res.json();
    if (res.ok) {
      toast({ type: 'success', title: 'สร้างลิงก์เชิญแล้ว' });
      setShowCreate(false);
      setFormNotes('');
      load();
    } else {
      toast({ type: 'error', title: 'สร้างไม่สำเร็จ', message: data.error });
    }
    setIsSubmitting(false);
  };

  const toggleActive = async (id: string, current: boolean) => {
    const res = await fetch(`/api/users/invitations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !current }),
    });
    if (res.ok) {
      toast({ type: 'success', title: !current ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว' });
      load();
    } else {
      const data = await res.json();
      toast({ type: 'error', title: 'อัปเดตไม่สำเร็จ', message: data.error });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('ลบลิงก์เชิญนี้?')) return;
    const res = await fetch(`/api/users/invitations/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast({ type: 'success', title: 'ลบแล้ว' });
      load();
    } else {
      const data = await res.json();
      toast({ type: 'error', title: 'ลบไม่สำเร็จ', message: data.error });
    }
  };

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    await navigator.clipboard.writeText(url);
    toast({ type: 'success', title: 'คัดลอกลิงก์แล้ว', message: url });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          สร้างลิงก์ให้พนักงานลงทะเบียน — กำหนดสิทธิ์ระบบและสาขาได้ต่อลิงก์
        </p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
          สร้างลิงก์เชิญ
        </Button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="ยังไม่มีลิงก์เชิญ"
          description="สร้างลิงก์แรกเพื่อให้พนักงานลงทะเบียนเข้ามา"
          action={
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
              สร้างลิงก์เชิญ
            </Button>
          }
        />
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                  <th className="px-4 py-3">สาขา</th>
                  <th className="px-4 py-3">สิทธิ์ระบบ</th>
                  <th className="px-4 py-3">หมายเหตุ</th>
                  <th className="px-4 py-3 text-center">สถานะ</th>
                  <th className="px-4 py-3 text-center">ใช้แล้ว</th>
                  <th className="px-4 py-3">สร้างเมื่อ</th>
                  <th className="px-4 py-3 text-right">การกระทำ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {items.map((inv) => (
                  <tr key={inv.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                      {inv.store?.store_name || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="info">{ROLE_LABELS[inv.role] || inv.role}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {inv.notes || '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleActive(inv.id, inv.active)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          inv.active ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                        title={inv.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                            inv.active ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center text-xs">{inv.used_count}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {formatThaiDate(inv.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => copyLink(inv.token)}
                          className="rounded-lg p-2 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/30"
                          title="คัดลอกลิงก์"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <a
                          href={`/invite/${inv.token}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                          title="เปิดลิงก์"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                        <button
                          onClick={() => handleDelete(inv.id)}
                          className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                          title="ลบ"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="สร้างลิงก์เชิญใหม่">
        <form onSubmit={handleCreate} className="space-y-4">
          <Select
            label="สาขา"
            value={formStoreId}
            onChange={(e) => setFormStoreId(e.target.value)}
            options={stores.map((s) => ({ value: s.id, label: s.store_name }))}
            required
          />
          <Select
            label="สิทธิ์ระบบ (Role)"
            value={formRole}
            onChange={(e) => setFormRole(e.target.value as UserRole)}
            options={INVITABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] || r }))}
            required
          />
          <Textarea
            label="หมายเหตุ (ไม่บังคับ)"
            value={formNotes}
            onChange={(e) => setFormNotes(e.target.value)}
            placeholder="เช่น: เชิญน้องโจ บาร์ Baccarat"
            rows={2}
          />
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
              ยกเลิก
            </Button>
            <Button type="submit" isLoading={isSubmitting} icon={<Plus className="h-4 w-4" />}>
              สร้างลิงก์
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
