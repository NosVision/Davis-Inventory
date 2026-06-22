'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  ShoppingCart,
  XCircle,
  Play,
  MapPin,
  AlertTriangle,
} from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Textarea,
  Modal,
  ModalFooter,
  toast,
} from '@/components/ui';
import { ImageLightbox } from '@/components/chat/image-lightbox';
import { RepairStatusBadge } from '@/components/repairs/repair-status-badge';
import { RepairPhotoInput } from '@/components/repairs/repair-photo-input';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { REPAIR_RESOLUTION_LABELS, REPAIR_PRIORITY_LABELS } from '@/lib/repairs/status';
import type { RepairRequest } from '@/types/database';

type ActionKind = 'start' | 'complete' | 'request_purchase' | 'approve_purchase' | 'reject_purchase' | 'cancel';

function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function RepairDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();

  const [repair, setRepair] = useState<RepairRequest | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);

  // Modals
  const [completeOpen, setCompleteOpen] = useState(false);
  const [afterPhotos, setAfterPhotos] = useState<string[]>([]);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [estCost, setEstCost] = useState('');
  const [purchaseNote, setPurchaseNote] = useState('');
  const [approveOpen, setApproveOpen] = useState<false | 'approve' | 'reject'>(false);
  const [ownerNote, setOwnerNote] = useState('');

  const fetchRepair = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('repair_requests')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      const rep = (data as RepairRequest) ?? null;
      setRepair(rep);
      if (rep) {
        const ids = [rep.reported_by, rep.assigned_to, rep.completed_by, rep.approved_by].filter(
          (x): x is string => !!x,
        );
        if (ids.length > 0) {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, display_name, username')
            .in('id', ids);
          const map: Record<string, string> = {};
          (profs ?? []).forEach((p: { id: string; display_name: string | null; username: string }) => {
            map[p.id] = p.display_name || p.username;
          });
          setNames(map);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchRepair();
  }, [fetchRepair]);

  const callAction = useCallback(
    async (action: ActionKind, payload: Record<string, unknown> = {}) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/repairs/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...payload }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'ดำเนินการไม่สำเร็จ');
        toast({ type: 'success', title: 'อัปเดตเรียบร้อย' });
        setCompleteOpen(false);
        setPurchaseOpen(false);
        setApproveOpen(false);
        setAfterPhotos([]);
        setEstCost('');
        setPurchaseNote('');
        setOwnerNote('');
        await fetchRepair();
      } catch (err) {
        toast({
          type: 'error',
          title: 'เกิดข้อผิดพลาด',
          message: err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ',
        });
      } finally {
        setBusy(false);
      }
    },
    [id, fetchRepair],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!repair) {
    return (
      <div className="space-y-4">
        <Link href="/repairs" className="inline-flex items-center gap-1 text-sm text-gray-500">
          <ArrowLeft className="h-4 w-4" /> กลับ
        </Link>
        <p className="py-12 text-center text-gray-500">ไม่พบใบแจ้งซ่อม</p>
      </div>
    );
  }

  const role = user?.role ?? '';
  const isAdmin = role === 'owner' || role === 'accountant';
  const isTech = ['technician', 'manager', 'owner', 'accountant'].includes(role);
  const canCancel = repair.reported_by === user?.id || isAdmin || role === 'manager';

  const canStart = isTech && repair.status === 'pending';
  const canComplete = isTech && ['pending', 'in_progress', 'approved'].includes(repair.status);
  const canRequestPurchase = isTech && ['pending', 'in_progress'].includes(repair.status);
  const canApprove = isAdmin && repair.status === 'awaiting_approval';
  const canShowCancel =
    canCancel && ['pending', 'in_progress', 'awaiting_approval', 'approved'].includes(repair.status);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/repairs"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="flex-1 truncate text-lg font-bold text-gray-900 dark:text-white">
          {repair.title}
        </h1>
        <RepairStatusBadge status={repair.status} />
      </div>

      <Card padding="none">
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            {repair.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {repair.location}
              </span>
            )}
            {repair.priority === 'urgent' && (
              <span className="inline-flex items-center gap-1 font-medium text-red-500">
                <AlertTriangle className="h-3.5 w-3.5" /> {REPAIR_PRIORITY_LABELS.urgent}
              </span>
            )}
          </div>

          {repair.description && (
            <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
              {repair.description}
            </p>
          )}

          {repair.photo_urls?.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">รูปก่อนซ่อม</p>
              <div className="grid grid-cols-3 gap-2">
                {repair.photo_urls.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={url}
                    src={url}
                    alt=""
                    onClick={() => setLightbox({ urls: repair.photo_urls, index: i })}
                    className="h-24 w-full cursor-pointer rounded-lg object-cover"
                  />
                ))}
              </div>
            </div>
          )}

          {repair.resolution && (
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800/50">
              <span className="text-gray-500">ผลการประเมิน: </span>
              <span className="font-medium text-gray-900 dark:text-white">
                {REPAIR_RESOLUTION_LABELS[repair.resolution]}
              </span>
              {repair.estimated_cost != null && (
                <span className="ml-2 text-gray-600 dark:text-gray-300">
                  ประมาณ {repair.estimated_cost.toLocaleString('th-TH')} บาท
                </span>
              )}
              {repair.purchase_note && (
                <p className="mt-1 text-gray-600 dark:text-gray-400">{repair.purchase_note}</p>
              )}
            </div>
          )}

          {repair.owner_note && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              หมายเหตุเจ้าของร้าน: {repair.owner_note}
            </div>
          )}

          {repair.after_photo_urls?.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-emerald-600">รูปหลังซ่อม</p>
              <div className="grid grid-cols-3 gap-2">
                {repair.after_photo_urls.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={url}
                    src={url}
                    alt=""
                    onClick={() => setLightbox({ urls: repair.after_photo_urls, index: i })}
                    className="h-24 w-full cursor-pointer rounded-lg object-cover"
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card padding="none">
        <CardHeader title="ข้อมูลการดำเนินงาน" />
        <CardContent className="space-y-1.5 text-sm">
          <Row label="ผู้แจ้ง" value={`${names[repair.reported_by ?? ''] ?? '-'} · ${fmtDateTime(repair.created_at)}`} />
          {repair.assigned_to && <Row label="ช่างผู้รับผิดชอบ" value={names[repair.assigned_to] ?? '-'} />}
          {repair.approved_by && (
            <Row label="อนุมัติโดย" value={`${names[repair.approved_by] ?? '-'} · ${fmtDateTime(repair.approved_at)}`} />
          )}
          {repair.completed_by && (
            <Row label="ปิดงานโดย" value={`${names[repair.completed_by] ?? '-'} · ${fmtDateTime(repair.completed_at)}`} />
          )}
        </CardContent>
      </Card>

      {/* Action panel */}
      {(canStart || canComplete || canRequestPurchase || canApprove || canShowCancel) && (
        <div className="flex flex-wrap gap-2">
          {canStart && (
            <Button variant="secondary" icon={<Play className="h-4 w-4" />} disabled={busy} onClick={() => callAction('start')}>
              รับงาน
            </Button>
          )}
          {canComplete && (
            <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} disabled={busy} onClick={() => setCompleteOpen(true)}>
              ซ่อมเสร็จแล้ว
            </Button>
          )}
          {canRequestPurchase && (
            <Button variant="outline" icon={<ShoppingCart className="h-4 w-4" />} disabled={busy} onClick={() => setPurchaseOpen(true)}>
              ต้องสั่งซื้อ
            </Button>
          )}
          {canApprove && (
            <>
              <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} disabled={busy} onClick={() => setApproveOpen('approve')}>
                อนุมัติสั่งซื้อ
              </Button>
              <Button variant="danger" icon={<XCircle className="h-4 w-4" />} disabled={busy} onClick={() => setApproveOpen('reject')}>
                ไม่อนุมัติ
              </Button>
            </>
          )}
          {canShowCancel && (
            <Button variant="ghost" disabled={busy} onClick={() => callAction('cancel')}>
              ยกเลิกใบแจ้ง
            </Button>
          )}
        </div>
      )}

      {/* Complete modal */}
      <Modal isOpen={completeOpen} onClose={() => setCompleteOpen(false)} title="ปิดงานซ่อม" description="แนบรูปหลังซ่อมเพื่อยืนยัน" size="md">
        <RepairPhotoInput label="รูปหลังซ่อม" value={afterPhotos} onChange={setAfterPhotos} folder="repair-after" />
        <ModalFooter>
          <Button variant="ghost" onClick={() => setCompleteOpen(false)}>ยกเลิก</Button>
          <Button
            variant="primary"
            isLoading={busy}
            disabled={afterPhotos.length === 0}
            onClick={() => callAction('complete', { afterPhotoUrls: afterPhotos })}
          >
            ยืนยันซ่อมเสร็จ
          </Button>
        </ModalFooter>
      </Modal>

      {/* Purchase request modal */}
      <Modal isOpen={purchaseOpen} onClose={() => setPurchaseOpen(false)} title="ต้องสั่งซื้ออะไหล่" description="ส่งขออนุมัติไปยังเจ้าของร้าน" size="md">
        <div className="space-y-3">
          <Input
            label="ประมาณการค่าใช้จ่าย (บาท)"
            type="number"
            inputMode="decimal"
            value={estCost}
            onChange={(e) => setEstCost(e.target.value)}
            placeholder="0"
          />
          <Textarea
            label="รายละเอียด / อะไหล่ที่ต้องสั่ง"
            rows={3}
            value={purchaseNote}
            onChange={(e) => setPurchaseNote(e.target.value)}
          />
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setPurchaseOpen(false)}>ยกเลิก</Button>
          <Button
            variant="primary"
            isLoading={busy}
            onClick={() =>
              callAction('request_purchase', {
                estimatedCost: estCost ? Number(estCost) : undefined,
                purchaseNote,
              })
            }
          >
            ส่งขออนุมัติ
          </Button>
        </ModalFooter>
      </Modal>

      {/* Approve / reject modal */}
      <Modal
        isOpen={approveOpen !== false}
        onClose={() => setApproveOpen(false)}
        title={approveOpen === 'reject' ? 'ไม่อนุมัติการสั่งซื้อ' : 'อนุมัติการสั่งซื้อ'}
        size="md"
      >
        <Textarea
          label="หมายเหตุ (ไม่บังคับ)"
          rows={3}
          value={ownerNote}
          onChange={(e) => setOwnerNote(e.target.value)}
        />
        <ModalFooter>
          <Button variant="ghost" onClick={() => setApproveOpen(false)}>ยกเลิก</Button>
          <Button
            variant={approveOpen === 'reject' ? 'danger' : 'primary'}
            isLoading={busy}
            onClick={() =>
              callAction(approveOpen === 'reject' ? 'reject_purchase' : 'approve_purchase', {
                ownerNote,
              })
            }
          >
            ยืนยัน
          </Button>
        </ModalFooter>
      </Modal>

      {lightbox && (
        <ImageLightbox
          images={lightbox.urls.map((url) => ({ url }))}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-right font-medium text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}
