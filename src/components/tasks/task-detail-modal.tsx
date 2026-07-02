'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Modal, ModalFooter, Button, Input, Textarea, toast } from '@/components/ui';
import { Loader2, Pin } from 'lucide-react';
import { TaskStatusBadge } from './task-status-badge';
import { TaskPriorityDot } from './task-priority-dot';
import { AttachmentInput } from './attachment-input';
import { AttachmentList } from './attachment-list';
import { initial, avatarColor, fmtThaiDate, relativeDaysTh } from '@/lib/tasks/format';
import type { TaskWithRelations, TaskAttachmentInput } from '@/types/tasks';

interface TaskDetailModalProps {
  taskId: string;
  currentUserId: string;
  onClose: () => void;
  onChanged: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-right text-gray-800 dark:text-gray-200">{children}</span>
    </div>
  );
}

export function TaskDetailModal({ taskId, currentUserId, onClose, onChanged }: TaskDetailModalProps) {
  const t = useTranslations('tasks');
  const tc = useTranslations('common');
  const locale = useLocale() as 'th' | 'en';
  const [task, setTask] = useState<TaskWithRelations | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [canClaim, setCanClaim] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submitMode, setSubmitMode] = useState(false);
  const [requestMode, setRequestMode] = useState(false);
  const [note, setNote] = useState('');
  const [reqItems, setReqItems] = useState('');
  const [reqCost, setReqCost] = useState('');
  const [attachments, setAttachments] = useState<TaskAttachmentInput[]>([]);
  const [ownerNote, setOwnerNote] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/tasks/${taskId}`);
    const data = await res.json();
    if (res.ok) {
      setTask(data.task);
      setCanApprove(!!data.canApprove);
      setIsOwner(!!data.isOwner);
      setCanClaim(!!data.canClaim);
    } else {
      toast({ type: 'error', title: t('detail.loadFailed'), message: data.error });
    }
    setLoading(false);
  }, [taskId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('detail.actionFailed'));
      toast({ type: 'success', title: t('detail.success') });
      setSubmitMode(false);
      setRequestMode(false);
      setNote('');
      setReqItems('');
      setReqCost('');
      setAttachments([]);
      setOwnerNote('');
      await load();
      onChanged();
    } catch (e) {
      toast({ type: 'error', title: tc('error'), message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const isAssignee = !!task?.assignees?.some((a) => a.user_id === currentUserId);
  const isAssigner = task?.assigner_id === currentUserId;
  const submittedCount = task?.assignees?.filter((a) => a.state === 'submitted' || a.state === 'done').length ?? 0;
  const totalAssignees = task?.assignees?.length ?? 0;

  const approvalReq = (task?.meta as
    | { approval_request?: { kind?: string; cost?: number | null; items?: string | null; note?: string | null } }
    | null
    | undefined)?.approval_request;
  const pendingKind: 'purchase' | 'completion' = approvalReq?.kind === 'purchase' ? 'purchase' : 'completion';
  const canDecide = pendingKind === 'purchase' ? isOwner : canApprove;
  // งานแบบเปิดให้รับ (claim) ที่ยังไม่มีผู้รับผิดชอบ
  const isOpenClaim =
    task?.status === 'in_progress' &&
    totalAssignees === 0 &&
    (task?.meta as { open_claim?: boolean } | null | undefined)?.open_claim === true;
  const canAct =
    task?.status === 'in_progress' &&
    !isOpenClaim &&
    (isAssignee || (isAssigner && totalAssignees === 0));

  return (
    <Modal isOpen onClose={onClose} title={task ? `#${task.ticket_no}` : t('detail.fallbackTitle')} size="lg">
      {loading || !task ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={task.status} />
            <TaskPriorityDot priority={task.priority} />
            {task.is_mine && (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                {t('detail.mine')}
              </span>
            )}
            {task.is_pinned && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                <Pin className="h-3 w-3" /> {t('detail.pinned')}
              </span>
            )}
          </div>

          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{task.title}</h3>
          {task.detail && (
            <p className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">{task.detail}</p>
          )}

          <div className="rounded-xl bg-gray-50 px-4 py-2 dark:bg-gray-800/50">
            {task.response_type !== 'submit' && (
              <Row label={t('detail.type')}>{t(`responseType.${task.response_type}`)}</Row>
            )}
            {task.category && <Row label={t('detail.category')}>{task.category}</Row>}
            {task.store_name && <Row label={t('detail.store')}>{task.store_name}</Row>}
            <Row label={t('detail.assigner')}>{task.assigner?.display_name || task.assigner?.username || '-'}</Row>
            <Row label={t('detail.assignedDate')}>
              {fmtThaiDate(task.assigned_at, true, locale)} <span className="text-gray-400">· {relativeDaysTh(task.assigned_at, locale)}</span>
            </Row>
            {task.start_date && <Row label={t('detail.startDate')}>{fmtThaiDate(task.start_date, true, locale)}</Row>}
            {task.due_date && <Row label={t('detail.dueDate')}>{fmtThaiDate(task.due_date, true, locale)}</Row>}
          </div>

          {/* ผู้รับผิดชอบ + ติดตามรายคน */}
          {totalAssignees > 0 && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('detail.responsible')}</span>
                <span className="text-xs text-gray-400">
                  {task.response_type === 'submit' ? t('detail.submitted') : t('detail.acknowledged')} {submittedCount}/{totalAssignees}
                </span>
              </div>
              <ul className="space-y-1">
                {task.assignees.map((a) => {
                  const name = a.profile?.display_name || a.profile?.username || t('detail.defaultUser');
                  return (
                    <li key={a.id} className="flex items-center gap-2 text-sm">
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                        style={{ backgroundColor: avatarColor(a.user_id) }}
                      >
                        {initial(name)}
                      </span>
                      <span className="flex-1 truncate text-gray-700 dark:text-gray-200">{name}</span>
                      <span className="text-xs text-gray-400">{t(`assigneeState.${a.state}`)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* ไฟล์แนบ */}
          {task.attachments?.length > 0 && (
            <div>
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('detail.attachments')}</span>
              <AttachmentList attachments={task.attachments} />
            </div>
          )}

          {/* ความเคลื่อนไหว (derived) */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('detail.activity')}</span>
            <ul className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
              <li>• {t('detail.activityAssigned', { name: task.assigner?.display_name || t('detail.defaultAssigner'), date: fmtThaiDate(task.created_at, true, locale) })}</li>
              {task.approved_at && (
                <li>
                  • {t('detail.activityDecision', { decision: task.approval_status === 'approved' ? t('detail.approved') : t('detail.rejected'), date: fmtThaiDate(task.approved_at, true, locale) })}
                  {task.owner_note ? ` · ${task.owner_note}` : ''}
                </li>
              )}
              {task.completed_at && <li>• {t('detail.activityCompleted', { date: fmtThaiDate(task.completed_at, true, locale) })}</li>}
            </ul>
          </div>

          {/* กล่องคำขออนุมัติ (เมื่อรออนุมัติ) */}
          {task.status === 'pending_approval' && approvalReq && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-900/10">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                {pendingKind === 'purchase' ? t('detail.purchaseRequest') : t('detail.completionRequest')}
              </p>
              {approvalReq.items && <p className="mt-1 text-gray-700 dark:text-gray-300">{t('detail.requestItems', { items: approvalReq.items })}</p>}
              {approvalReq.cost != null && (
                <p className="text-gray-700 dark:text-gray-300">{t('detail.requestCost', { cost: Number(approvalReq.cost).toLocaleString('th-TH') })}</p>
              )}
              {approvalReq.note && <p className="text-gray-600 dark:text-gray-400">{t('detail.requestNote', { note: approvalReq.note })}</p>}
            </div>
          )}

          {/* แผงส่งงาน */}
          {submitMode && (
            <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-900/10">
              <AttachmentInput value={attachments} onChange={setAttachments} required={task.require_attachment} />
              <Textarea label={t('detail.note')} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
          )}

          {/* แผงขออนุมัติจากเจ้าของ */}
          {requestMode && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-900/10">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{t('detail.requestFromOwner')}</p>
              <Input label={t('detail.reqItemsLabel')} value={reqItems} onChange={(e) => setReqItems(e.target.value)} placeholder={t('detail.reqItemsPlaceholder')} />
              <Input label={t('detail.reqCostLabel')} type="number" min={0} value={reqCost} onChange={(e) => setReqCost(e.target.value)} placeholder={t('detail.reqCostPlaceholder')} />
              <Textarea label={t('detail.reqReasonLabel')} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              <AttachmentInput value={attachments} onChange={setAttachments} />
            </div>
          )}

          {/* แผงหมายเหตุผู้อนุมัติ */}
          {task.status === 'pending_approval' && canDecide && (
            <Textarea
              label={t('detail.ownerNoteLabel')}
              value={ownerNote}
              onChange={(e) => setOwnerNote(e.target.value)}
              rows={2}
            />
          )}
        </div>
      )}

      {task && (
        <ModalFooter className="flex-wrap">
          {/* in_progress: ยืนยัน panel ที่เปิดอยู่ */}
          {canAct && requestMode && (
            <Button
              onClick={() => act('request_approval', { items: reqItems, cost: reqCost ? Number(reqCost) : undefined, note, attachments })}
              isLoading={busy}
            >
              {t('detail.confirmRequest')}
            </Button>
          )}
          {canAct && submitMode && (
            <Button onClick={() => act('submit', { note, attachments })} isLoading={busy}>{t('detail.confirmSubmit')}</Button>
          )}
          {canAct && (submitMode || requestMode) && (
            <Button variant="ghost" onClick={() => { setSubmitMode(false); setRequestMode(false); }}>{t('detail.goBack')}</Button>
          )}

          {/* in_progress: ปุ่มหลัก (ขึ้นกับประเภทการตอบกลับ) */}
          {canAct && !submitMode && !requestMode && (
            task.response_type === 'submit' ? (
              <>
                <Button onClick={() => setSubmitMode(true)} isLoading={busy}>{t('detail.submit')}</Button>
                <Button variant="outline" onClick={() => setRequestMode(true)}>{t('detail.requestApproval')}</Button>
              </>
            ) : (
              <Button onClick={() => act('submit')} isLoading={busy}>
                {task.response_type === 'acknowledge' ? t('detail.acknowledge') : t('detail.acknowledgeRead')}
              </Button>
            )
          )}

          {/* open-claim: รับงาน (ยังไม่มีผู้รับผิดชอบ) — เฉพาะคนที่ตรงกลุ่มเป้าหมายที่ห้องตั้งไว้ */}
          {isOpenClaim && canClaim && (
            <Button onClick={() => act('claim')} isLoading={busy}>{t('detail.claim')}</Button>
          )}
          {isOpenClaim && !canClaim && (
            <p className="w-full text-xs text-gray-400">{t('detail.claimWaiting')}</p>
          )}

          {/* pending_approval: อนุมัติ/ไม่อนุมัติ */}
          {task.status === 'pending_approval' && canDecide && (
            <>
              <Button variant="danger" onClick={() => act('reject', { ownerNote })} isLoading={busy}>{t('detail.reject')}</Button>
              <Button onClick={() => act('approve', { ownerNote })} isLoading={busy}>{t('detail.approve')}</Button>
            </>
          )}

          {/* scheduled: เริ่มงานก่อนถึงวันได้ */}
          {task.status === 'scheduled' && (isAssignee || isOwner || isAssigner) && (
            <Button onClick={() => act('start_now')} isLoading={busy}>{t('detail.startNow')}</Button>
          )}

          {/* cancel */}
          {(task.status === 'in_progress' || task.status === 'pending_approval' || task.status === 'scheduled') && (isAssigner || isOwner) && !submitMode && !requestMode && (
            <Button variant="ghost" onClick={() => act('cancel')} isLoading={busy}>{t('detail.cancelTask')}</Button>
          )}

          {(isOwner || isAssigner) && (
            <Button variant="ghost" onClick={() => act(task.is_pinned ? 'unpin' : 'pin')} isLoading={busy}>
              {task.is_pinned ? t('detail.unpin') : t('detail.pin')}
            </Button>
          )}

          <Button variant="ghost" onClick={onClose}>{t('detail.close')}</Button>
        </ModalFooter>
      )}
    </Modal>
  );
}
