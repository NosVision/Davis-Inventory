import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// The caller's own hr_employees fields we expose to ESS. NEVER include rate_satang,
// tax_id, sso_no, notes, or end_reason — the ESS profile must not surface those (P0 gate).
const EMPLOYEE_SELECT =
  'start_date, status, work_hours_per_day, bank_name, bank_account_no, bank_account_name, ' +
  'emergency_contact, ' +
  'position:hr_positions(name), department:hr_departments(name), company:hr_companies(name)';

// Mask a bank account number down to its last 4 digits (e.g. ••••1234), or null.
function maskAccountNo(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) return `••••${digits}`;
  return `••••${digits.slice(-4)}`;
}

// GET /api/hr/ess/profile — the caller's OWN limited profile (§J6). Auth-any: never
// exposes another user's data, and never returns pay/tax/SSO/notes fields.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();

  const { data: profile, error: profileErr } = await service
    .from('profiles')
    .select('display_name, username, avatar_url, phone')
    .eq('id', user.id)
    .maybeSingle();
  if (profileErr) return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });

  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .select(EMPLOYEE_SELECT)
    .eq('profile_id', user.id)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to load employee' }, { status: 500 });

  const e = emp as unknown as Record<string, unknown> | null;
  const position = e?.position as { name: string } | null;
  const department = e?.department as { name: string } | null;
  const company = e?.company as { name: string } | null;

  return NextResponse.json({
    data: {
      display_name: (profile?.display_name as string | null) ?? null,
      username: (profile?.username as string | null) ?? null,
      avatar_url: (profile?.avatar_url as string | null) ?? null,
      phone: (profile?.phone as string | null) ?? null,
      position: position?.name ?? null,
      department: department?.name ?? null,
      company: company?.name ?? null,
      start_date: (e?.start_date as string | null) ?? null,
      status: (e?.status as string | null) ?? null,
      work_hours_per_day: (e?.work_hours_per_day as number | null) ?? null,
      bank_name: (e?.bank_name as string | null) ?? null,
      bank_account_no_masked: maskAccountNo(e?.bank_account_no),
      bank_account_name: (e?.bank_account_name as string | null) ?? null,
      emergency_contact: e?.emergency_contact ?? null,
    },
  });
}
