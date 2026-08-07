import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { attachFullNames } from '@/lib/hr/employee-name-map';

const TABLE = 'hr_warnings';

const COLS =
  'id, user_id, issued_by, store_id, company_id, level, sc_deduct_percent, amount_satang, ' +
  'sc_deduct_cycles, reason, detail, evidence_path, issued_at, expires_at, status, void_reason, ' +
  'created_at, updated_at';

const ISSUER_EMBED =
  'issuer:profiles!hr_warnings_issued_by_fkey(id, display_name, username)';
const SIGNATURES_EMBED = 'signatures:hr_warning_signatures(role, signed_by, signed_at)';

// GET /api/hr/ess/warnings — the caller's OWN disciplinary warnings, newest first.
// Auth-any: never exposes warnings issued against other employees.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .select(`${COLS}, ${ISSUER_EMBED}, ${SIGNATURES_EMBED}`)
    .eq('user_id', user.id)
    .order('issued_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load warnings' }, { status: 500 });

  // The employee reading their own warning should see who issued it by their ชื่อจริง, not a
  // login nickname — this is the same document HR prints for the personnel file.
  return NextResponse.json({ data: await attachFullNames(service, data ?? [], 'issuer') });
}
