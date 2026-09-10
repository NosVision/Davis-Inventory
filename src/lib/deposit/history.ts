export const DEPOSIT_HISTORY_PAGE_SIZE = 50;

export const DEPOSIT_HISTORY_ACTIONS = [
  'DEPOSIT_CREATED',
  'DEPOSIT_REQUEST_APPROVED',
  'DEPOSIT_REQUEST_REJECTED',
  'DEPOSIT_STATUS_CHANGED',
  'DEPOSIT_BAR_CONFIRMED',
  'DEPOSIT_BAR_REJECTED',
  'DEPOSIT_UPDATED',
  'DEPOSIT_EXPIRY_EXTENDED',
  'DEPOSIT_VIP_CHANGED',
  'DEPOSIT_NO_DEPOSIT_CREATED',
  'WITHDRAWAL_REQUESTED',
  'WITHDRAWAL_COMPLETED',
  'WITHDRAWAL_REJECTED',
  'WITHDRAWAL_CANCELLED',
  'TRANSFER_CREATED',
  'TRANSFER_CONFIRMED',
  'TRANSFER_REJECTED',
  'CUSTOMER_DEPOSIT_REQUEST',
  'CUSTOMER_DEPOSIT_REQUEST_CANCELLED',
  'CUSTOMER_WITHDRAWAL_REQUEST',
  'CRON_DEPOSIT_EXPIRED',
  'VIP_DEPOSIT_EXPIRED',
] as const;

export type DepositHistoryAction = (typeof DEPOSIT_HISTORY_ACTIONS)[number];

export interface DepositHistoryQuery {
  page: number;
  q: string;
  storeId: string;
  action: DepositHistoryAction | '';
  from: string;
  to: string;
}

export interface DepositHistorySource {
  record_id?: string | null;
  deposit_code?: string | null;
  customer_name?: string | null;
  product_name?: string | null;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
}

export interface DepositHistorySummary {
  depositCode: string;
  customerName: string;
  productName: string;
}

export interface ChangedField {
  field: string;
  before: unknown;
  after: unknown;
}

export function canAccessDepositHistory(role: string | null | undefined): boolean {
  return role === 'hq';
}

function cleanParam(value: string | null, maxLength: number): string {
  return (value ?? '').trim().slice(0, maxLength);
}

export function parseDepositHistoryQuery(params: URLSearchParams): DepositHistoryQuery {
  const rawPage = Number.parseInt(params.get('page') ?? '1', 10);
  const action = cleanParam(params.get('action'), 80);

  return {
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
    q: cleanParam(params.get('q'), 120),
    storeId: cleanParam(params.get('storeId'), 80),
    action: DEPOSIT_HISTORY_ACTIONS.includes(action as DepositHistoryAction)
      ? (action as DepositHistoryAction)
      : '',
    from: cleanParam(params.get('from'), 10),
    to: cleanParam(params.get('to'), 10),
  };
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '-';
}

export function getDepositHistorySummary(row: DepositHistorySource): DepositHistorySummary {
  const before = row.old_value ?? {};
  const after = row.new_value ?? {};

  return {
    depositCode: firstText(row.deposit_code, after.deposit_code, before.deposit_code, row.record_id),
    customerName: firstText(row.customer_name, after.customer_name, before.customer_name),
    productName: firstText(row.product_name, after.product_name, before.product_name),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function flatten(value: Record<string, unknown>, prefix = ''): Map<string, unknown> {
  const result = new Map<string, unknown>();

  for (const key of Object.keys(value).sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    const item = value[key];
    if (isPlainObject(item)) {
      const nested = flatten(item, path);
      if (nested.size === 0) result.set(path, item);
      else nested.forEach((nestedValue, nestedPath) => result.set(nestedPath, nestedValue));
    } else {
      result.set(path, item);
    }
  }

  return result;
}

export function getChangedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): ChangedField[] {
  const beforeFields = flatten(before ?? {});
  const afterFields = flatten(after ?? {});
  const keys = [...new Set([...beforeFields.keys(), ...afterFields.keys()])].sort();

  return keys
    .filter((field) => JSON.stringify(beforeFields.get(field)) !== JSON.stringify(afterFields.get(field)))
    .map((field) => ({
      field,
      before: beforeFields.get(field),
      after: afterFields.get(field),
    }));
}
