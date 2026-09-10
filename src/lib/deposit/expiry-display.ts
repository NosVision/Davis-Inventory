import { effectiveExpiryISO } from '../utils/date';

export type DepositExpiryState = 'none' | 'ok' | 'soon' | 'last_call' | 'expired';
export interface DepositExpiryDisplay {
  state: DepositExpiryState;
  days: number | null;
  withdrawable: boolean;
  deadline: string | null;
}

/** The persisted deadline is authoritative, even while cron status is stale. */
export function depositExpiryDisplay(deposit: {
  expiry_date?: string | null;
  collection_deadline_at?: string | null;
  status?: string | null;
}): DepositExpiryDisplay {
  const raw = deposit.expiry_date;
  const deadline = deposit.collection_deadline_at !== undefined
    ? deposit.collection_deadline_at
    : (raw ? effectiveExpiryISO(raw) : null);
  const days = raw ? Math.ceil((new Date(raw).getTime() - Date.now()) / 86_400_000) : null;
  const ended = deposit.status === 'expired' || (!!deadline && new Date(deadline).getTime() <= Date.now());
  const withdrawable = !ended && (!deposit.status || deposit.status === 'in_store');
  if (ended) return { state: 'expired', days, deadline, withdrawable: false };
  if (!deadline) return { state: 'none', days: null, deadline, withdrawable };
  if ((days ?? 0) <= 0) return { state: 'last_call', days, deadline, withdrawable };
  return { state: (days ?? 0) <= 7 ? 'soon' : 'ok', days, deadline, withdrawable };
}

export function depositExpiryLabel(d: DepositExpiryDisplay, locale = 'th'): string {
  const th = locale.startsWith('th');
  if (!d.deadline) return d.state === 'expired'
    ? (th ? 'สิ้นสุดการฝากแล้ว' : 'Storage ended')
    : (th ? 'ไม่มีวันหมดอายุ' : 'No expiry');
  const date = new Intl.DateTimeFormat(th ? 'th-TH' : 'en-GB', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(d.deadline));
  return d.state === 'expired'
    ? (th ? `สิ้นสุดสิทธิ์แล้ว: ${date} น.` : `Collection ended: ${date} (Bangkok)`)
    : (th ? `รับเหล้าก่อน ${date} น.` : `Collect before ${date} (Bangkok)`);
}

export function depositExpiryLabelTH(d: DepositExpiryDisplay): string {
  return depositExpiryLabel(d, 'th');
}

export function depositStatusForDisplay(deposit: Parameters<typeof depositExpiryDisplay>[0]): string {
  const status = deposit.status || '';
  return ['in_store', 'pending_withdrawal'].includes(status) && depositExpiryDisplay(deposit).state === 'expired'
    ? 'expired' : status;
}
