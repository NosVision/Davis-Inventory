import { NextRequest, NextResponse } from 'next/server';

import {
  DEPOSIT_HISTORY_PAGE_SIZE,
  canAccessDepositHistory,
  parseDepositHistoryQuery,
} from '@/lib/deposit/history';
import { createClient } from '@/lib/supabase/server';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });
  if (!canAccessDepositHistory((profile as { role?: string } | null)?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const filters = parseDepositHistoryQuery(request.nextUrl.searchParams);
  const fromRow = (filters.page - 1) * DEPOSIT_HISTORY_PAGE_SIZE;
  const toRow = fromRow + DEPOSIT_HISTORY_PAGE_SIZE - 1;

  let historyQuery = supabase
    .from('hq_deposit_audit_history')
    .select(
      'id, store_id, action_type, table_name, record_id, old_value, new_value, changed_by, created_at, actor_name, actor_username, actor_role, store_name, store_code, deposit_code, customer_name, product_name',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (filters.q) historyQuery = historyQuery.ilike('search_text', `%${filters.q}%`);
  if (filters.storeId) historyQuery = historyQuery.eq('store_id', filters.storeId);
  if (filters.action) historyQuery = historyQuery.eq('action_type', filters.action);
  if (DATE_PATTERN.test(filters.from)) {
    historyQuery = historyQuery.gte('created_at', `${filters.from}T00:00:00+07:00`);
  }
  if (DATE_PATTERN.test(filters.to)) {
    historyQuery = historyQuery.lte('created_at', `${filters.to}T23:59:59.999+07:00`);
  }

  const [{ data, error, count }, { data: stores, error: storesError }] = await Promise.all([
    historyQuery.range(fromRow, toRow),
    supabase.from('stores').select('id, store_code, store_name').order('store_name'),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (storesError) return NextResponse.json({ error: storesError.message }, { status: 500 });

  return NextResponse.json({
    data: data ?? [],
    count: count ?? 0,
    page: filters.page,
    pageSize: DEPOSIT_HISTORY_PAGE_SIZE,
    stores: stores ?? [],
  });
}
