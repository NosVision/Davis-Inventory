import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, requireStoreManager } from '@/lib/hr/route-auth';

const TABLE = 'hr_warnings';

const COLS =
  'id, user_id, issued_by, store_id, company_id, level, sc_deduct_percent, amount_satang, ' +
  'sc_deduct_cycles, reason, detail, evidence_path, issued_at, expires_at, status, void_reason, ' +
  'created_at, updated_at';

const EMPLOYEE_EMBED =
  'employee:profiles!hr_warnings_user_id_fkey(id, display_name, username)';
const ISSUER_EMBED =
  'issuer:profiles!hr_warnings_issued_by_fkey(id, display_name, username)';
const SIGNATURES_EMBED =
  'signatures:hr_warning_signatures(id, role, signed_by, signature_path, signed_at)';

// GET /api/hr/warnings/[id] — full warning detail for HR / a store manager, with the
// employee + issuer profiles and the full signatures list. Store-scoped warnings gate
// on the store manager; company-wide (or store-less) warnings require HR.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = createServiceClient();

  const { data, error } = await service
    .from(TABLE)
    .select(`${COLS}, ${EMPLOYEE_EMBED}, ${ISSUER_EMBED}, ${SIGNATURES_EMBED}`)
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Failed to load warning' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Warning not found' }, { status: 404 });

  const storeId = (data as unknown as { store_id: string | null }).store_id;
  const auth = storeId ? await requireStoreManager(storeId) : await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  return NextResponse.json({ data });
}
