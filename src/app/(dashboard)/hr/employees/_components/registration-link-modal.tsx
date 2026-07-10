'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Copy, Link2, Trash2, Send } from 'lucide-react';
import { Modal, ModalFooter, Button, toast } from '@/components/ui';

interface LinkInfo {
  url: string;
  expires_at: string;
  used_count: number;
}

// HR self-registration link manager (owner ask 2026-07-10). Mint one reusable link that new hires
// open to self-onboard (→ role 'not_assign' + an hr_employees record). Exactly one active link.
export function RegistrationLinkModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<LinkInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/registration-link');
      const j = await res.json().catch(() => ({}));
      setLink(res.ok ? ((j.data ?? null) as LinkInfo | null) : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

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
    <Modal isOpen={isOpen} onClose={onClose} title="ลิงก์ให้พนักงานสมัครเอง" size="md">
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        ส่งลิงก์นี้ให้พนักงานใหม่สมัครเอง — ตั้งชื่อผู้ใช้/รหัสผ่าน + เลือกชื่อจากข้อมูลนำเข้า (หรือกรอกเอง) ระบบจะสร้างบัญชีให้ทันที
        สิทธิ์เริ่มต้นเป็น &quot;ยังไม่ระบุ&quot; แล้ว HR ค่อยกำหนดสิทธิ์ทีหลัง
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

      <ModalFooter>
        {link && (
          <Button variant="ghost" onClick={revoke} disabled={busy} className="mr-auto text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20" icon={<Trash2 className="h-4 w-4" />}>
            ยกเลิกลิงก์
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>ปิด</Button>
        <Button onClick={create} isLoading={busy} icon={<Send className="h-4 w-4" />}>
          {link ? 'สร้างลิงก์ใหม่' : 'สร้างลิงก์'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
