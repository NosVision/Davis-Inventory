'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal, ModalFooter, Button, Input, Textarea, toast } from '@/components/ui';
import { Loader2, Pin } from 'lucide-react';
import { TaskStatusBadge } from './task-status-badge';
import { TaskPriorityDot } from './task-priority-dot';
import { AttachmentInput } from './attachment-input';
import { AttachmentList } from './attachment-list';
import { TASK_ASSIGNEE_STATE_LABELS, TASK_RESPONSE_TYPE_LABELS } from '@/lib/tasks/status';
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
  const [task, setTask] = useState<TaskWithRelations | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
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
    } else {
      toast({ type: 'error', title: 'โหลดงานไม่สำเร็จ', message: data.error });
    }
    setLoading(false);
  }, [taskId]);

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
      if (!res.ok) throw new Error(data.error || 'ดำเนินการไม่สำเร็จ');
      toast({ type: 'success', title: 'สำเร็จ' });
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
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
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
    <Modal isOpen onClose={onClose} title={task ? `#${task.ticket_no}` : 'งาน'} size="lg">
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
                ของฉัน
              </span>
            )}
            {task.is_pinned && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                <Pin className="h-3 w-3" /> ปักหมุด
              </span>
            )}
          </div>

          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{task.title}</h3>
          {task.detail && (
            <p className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">{task.detail}</p>
          )}

          <div className="rounded-xl bg-gray-50 px-4 py-2 dark:bg-gray-800/50">
            {task.response_type !== 'submit' && (
              <Row label="ประเภท">{TASK_RESPONSE_TYPE_LABELS[task.response_type]}</Row>
            )}
            {task.category && <Row label="หมวด">{task.category}</Row>}
            {task.store_name && <Row label="สาขา">{task.store_name}</Row>}
            <Row label="ผู้จ่ายงาน">{task.assigner?.display_name || task.assigner?.username || '-'}</Row>
            <Row label="วันที่จ่ายงาน">
              {fmtThaiDate(task.assigned_at)} <span className="text-gray-400">· {relativeDaysTh(task.assigned_at)}</span>
            </Row>
            {task.start_date && <Row label="วันเริ่มงาน">{fmtThaiDate(task.start_date)}</Row>}
            {task.due_date && <Row label="กำหนดเสร็จ">{fmtThaiDate(task.due_date)}</Row>}
          </div>

          {/* ผู้รับผิดชอบ + ติดตามรายคน */}
          {totalAssignees > 0 && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">ผู้รับผิดชอบ</span>
                <span className="text-xs text-gray-400">
                  {task.response_type === 'submit' ? 'ส่งแล้ว' : 'รับทราบ'} {submittedCount}/{totalAssignees}
                </span>
              </div>
              <ul className="space-y-1">
                {task.assignees.map((a) => {
                  const name = a.profile?.display_name || a.profile?.username || 'ผู้ใช้';
                  return (
                    <li key={a.id} className="flex items-center gap-2 text-sm">
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                        style={{ backgroundColor: avatarColor(a.user_id) }}
                      >
                        {initial(name)}
                      </span>
                      <span className="flex-1 truncate text-gray-700 dark:text-gray-200">{name}</span>
                      <span className="text-xs text-gray-400">{TASK_ASSIGNEE_STATE_LABELS[a.state]}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* ไฟล์แนบ */}
          {task.attachments?.length > 0 && (
            <div>
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">ไฟล์แนบ</span>
              <AttachmentList attachments={task.attachments} />
            </div>
          )}

          {/* ความเคลื่อนไหว (derived) */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">ความเคลื่อนไหว</span>
            <ul className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
              <li>• {task.assigner?.display_name || 'ผู้จ่ายงาน'} มอบหมายงานนี้ — {fmtThaiDate(task.created_at)}</li>
              {task.approved_at && (
                <li>
                  • {task.approval_status === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ'}แล้ว — {fmtThaiDate(task.approved_at)}
                  {task.owner_note ? ` · ${task.owner_note}` : ''}
                </li>
              )}
              {task.completed_at && <li>• งานเสร็จ — {fmtThaiDate(task.completed_at)}</li>}
            </ul>
          </div>

          {/* กล่องคำขออนุมัติ (เมื่อรออนุมัติ) */}
          {task.status === 'pending_approval' && approvalReq && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-900/10">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                {pendingKind === 'purchase' ? '🛒 ขออนุมัติซื้อของ/ค่าใช้จ่าย' : '📝 รออนุมัติงานเสร็จ'}
              </p>
              {approvalReq.items && <p className="mt-1 text-gray-700 dark:text-gray-300">รายการ: {approvalReq.items}</p>}
              {approvalReq.cost != null && (
                <p className="text-gray-700 dark:text-gray-300">ราคาประเมิน: {Number(approvalReq.cost).toLocaleString('th-TH')} บาท</p>
              )}
              {approvalReq.note && <p className="text-gray-600 dark:text-gray-400">หมายเหตุ: {approvalReq.note}</p>}
            </div>
          )}

          {/* แผงส่งงาน */}
          {submitMode && (
            <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-900/10">
              <AttachmentInput value={attachments} onChange={setAttachments} required={task.require_attachment} />
              <Textarea label="หมายเหตุ" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
          )}

          {/* แผงขออนุมัติจากเจ้าของ */}
          {requestMode && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-900/10">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">ขออนุมัติจากเจ้าของ</p>
              <Input label="รายการที่ต้องซื้อ/ทำ (ถ้ามี)" value={reqItems} onChange={(e) => setReqItems(e.target.value)} placeholder="เช่น คอมเพรสเซอร์แอร์ใหม่" />
              <Input label="ราคาประเมิน (บาท)" type="number" min={0} value={reqCost} onChange={(e) => setReqCost(e.target.value)} placeholder="ไม่ระบุก็ได้" />
              <Textarea label="เหตุผล/รายละเอียด" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              <AttachmentInput value={attachments} onChange={setAttachments} />
            </div>
          )}

          {/* แผงหมายเหตุผู้อนุมัติ */}
          {task.status === 'pending_approval' && canDecide && (
            <Textarea
              label="หมายเหตุถึงผู้รับผิดชอบ (ถ้ามี)"
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
              ยืนยันขออนุมัติ
            </Button>
          )}
          {canAct && submitMode && (
            <Button onClick={() => act('submit', { note, attachments })} isLoading={busy}>ยืนยันส่งงาน</Button>
          )}
          {canAct && (submitMode || requestMode) && (
            <Button variant="ghost" onClick={() => { setSubmitMode(false); setRequestMode(false); }}>ย้อนกลับ</Button>
          )}

          {/* in_progress: ปุ่มหลัก (ขึ้นกับประเภทการตอบกลับ) */}
          {canAct && !submitMode && !requestMode && (
            task.response_type === 'submit' ? (
              <>
                <Button onClick={() => setSubmitMode(true)} isLoading={busy}>ส่งงาน</Button>
                <Button variant="outline" onClick={() => setRequestMode(true)}>ขออนุมัติจากเจ้าของ</Button>
              </>
            ) : (
              <Button onClick={() => act('submit')} isLoading={busy}>
                {task.response_type === 'acknowledge' ? 'รับทราบ' : 'รับทราบว่าอ่านแล้ว'}
              </Button>
            )
          )}

          {/* open-claim: รับงาน (ยังไม่มีผู้รับผิดชอบ) */}
          {isOpenClaim && (
            <Button onClick={() => act('claim')} isLoading={busy}>รับงาน</Button>
          )}

          {/* pending_approval: อนุมัติ/ไม่อนุมัติ */}
          {task.status === 'pending_approval' && canDecide && (
            <>
              <Button variant="danger" onClick={() => act('reject', { ownerNote })} isLoading={busy}>ไม่อนุมัติ</Button>
              <Button onClick={() => act('approve', { ownerNote })} isLoading={busy}>อนุมัติ</Button>
            </>
          )}

          {/* scheduled: เริ่มงานก่อนถึงวันได้ */}
          {task.status === 'scheduled' && (isAssignee || isOwner || isAssigner) && (
            <Button onClick={() => act('start_now')} isLoading={busy}>เริ่มเลย</Button>
          )}

          {/* cancel */}
          {(task.status === 'in_progress' || task.status === 'pending_approval' || task.status === 'scheduled') && (isAssigner || isOwner) && !submitMode && !requestMode && (
            <Button variant="ghost" onClick={() => act('cancel')} isLoading={busy}>ยกเลิกงาน</Button>
          )}

          {(isOwner || isAssigner) && (
            <Button variant="ghost" onClick={() => act(task.is_pinned ? 'unpin' : 'pin')} isLoading={busy}>
              {task.is_pinned ? 'ยกเลิกปักหมุด' : 'ปักหมุด'}
            </Button>
          )}

          <Button variant="ghost" onClick={onClose}>ปิด</Button>
        </ModalFooter>
      )}
    </Modal>
  );
}
