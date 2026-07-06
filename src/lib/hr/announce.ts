import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyUser } from '@/lib/notifications/service';
import { logHrAudit } from '@/lib/hr/audit';

// ⑤ "เงินเดือนออกแล้ว" — push the payslip-ready notification to every employee with a slip in
// a FINALIZED payrun and stamp announced_at/by (double-blast protection). Shared by the manual
// HR button and the immediate-on-finalize mode.

export type AnnounceResult =
  | { ok: true; notified: number; already?: boolean }
  | { ok: false; status: number; error: string };

export async function announcePayrun(
  service: SupabaseClient,
  params: { payrunId: string; actorId: string; resend?: boolean }
): Promise<AnnounceResult> {
  const { data: payrun, error: prErr } = await service
    .from('hr_payruns')
    .select('id, status, store_id, period_year, period_month, announced_at, company:hr_companies(name)')
    .eq('id', params.payrunId)
    .maybeSingle();
  if (prErr) return { ok: false, status: 500, error: 'Failed to load payrun' };
  if (!payrun) return { ok: false, status: 404, error: 'Payrun not found' };
  if (payrun.status !== 'finalized') {
    return { ok: false, status: 409, error: 'Finalize the payrun before announcing' };
  }
  if (payrun.announced_at && !params.resend) {
    return { ok: false, status: 409, error: 'Already announced — pass resend to send again' };
  }

  const { data: slips, error: slipErr } = await service
    .from('hr_payslips')
    .select('user_id')
    .eq('payrun_id', params.payrunId);
  if (slipErr) return { ok: false, status: 500, error: 'Failed to load payslips' };
  const userIds = [...new Set((slips ?? []).map((s) => s.user_id as string))];

  const period = `${String(payrun.period_month).padStart(2, '0')}/${payrun.period_year}`;
  const company = (payrun.company as { name?: string | null } | null)?.name ?? '';
  await Promise.allSettled(
    userIds.map((userId) =>
      notifyUser({
        userId,
        storeId: (payrun.store_id as string | null) ?? null,
        type: 'hr_payslip_ready',
        title: 'เงินเดือนออกแล้ว 🎉',
        body: `สลิปเงินเดือนงวด ${period}${company ? ` (${company})` : ''} พร้อมดูแล้ว — แตะเพื่อเปิดสลิปของคุณ`,
        data: { url: '/me/payslips' },
      })
    )
  );

  await service
    .from('hr_payruns')
    .update({ announced_at: new Date().toISOString(), announced_by: params.actorId })
    .eq('id', params.payrunId);

  await logHrAudit(service, {
    actorId: params.actorId,
    action: 'update',
    table: 'hr_payruns',
    recordId: params.payrunId,
    before: { announced_at: payrun.announced_at },
    after: { announced: true, notified: userIds.length },
    reason: params.resend ? 'payslip announcement re-sent' : 'payslip announcement sent',
  });

  return { ok: true, notified: userIds.length };
}
