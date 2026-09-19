import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope } from '@/lib/hr/route-auth';
import { employeeNameLabel } from '@/lib/hr/employee-name';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

interface PickerRow {
  id: string;
  profile_id: string | null;
  full_name: string | null;
  company_id: string | null;
  profile: { display_name: string | null; username: string | null; is_system: boolean | null } | null;
}

/** One entry of the picker: keyed on the login, because hr_employees.supervisor_id → profiles.id. */
export interface PickerOption {
  id: string;
  employee_id: string;
  company_id: string | null;
  /** "ชื่อจริง (ชื่อเล่น)" via employeeNameLabel — never the bare account label. */
  label: string;
}

// GET /api/hr/employees/picker?company_id=<uuid|none>&exclude=<hr_employees.id>
//
// A lightweight "choose a colleague" list for the employee form's supervisor field. The form used
// to read every active profile straight from the browser: any company, system accounts included,
// labelled by the account name ("ACC Baccarat"), so HR could not tell who was who and could file
// someone under a supervisor at another entity. HR asked (2026-09-16) for the list to be split by
// company and to show real names. Current staff only (active/probation) — a leaver cannot be
// anyone's supervisor — and never the person being edited.
export async function GET(request: NextRequest) {
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const sp = request.nextUrl.searchParams;
  const companyParam = sp.get('company_id') ?? '';
  const exclude = sp.get('exclude') ?? '';

  const service = createServiceClient();
  let q = service
    .from('hr_employees')
    .select(
      'id, profile_id, full_name, company_id, ' +
        'profile:profiles!hr_employees_profile_id_fkey(display_name, username, is_system)'
    )
    .in('status', ['active', 'probation'])
    .not('profile_id', 'is', null);
  if (companyParam === 'none') q = q.is('company_id', null);
  else if (companyParam) q = q.eq('company_id', companyParam);
  if (exclude) q = q.neq('id', exclude);

  // §P5.5: a store-scoped manager only ever sees their own venues' people, as in the list route.
  if (scope.storeIds) {
    const { data: us, error: usErr } = await service
      .from('user_stores')
      .select('user_id')
      .in('store_id', scope.storeIds);
    if (usErr) return NextResponse.json({ error: 'Scope filter failed' }, { status: 500 });
    const ids = (us ?? []).map((r) => r.user_id as string);
    q = q.in('profile_id', ids.length ? ids : [NIL_UUID]);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: 'Failed to load people' }, { status: 500 });

  const options: PickerOption[] = ((data ?? []) as unknown as PickerRow[])
    .filter((r) => !!r.profile_id && !r.profile?.is_system)
    .map((r) => ({
      id: r.profile_id as string,
      employee_id: r.id,
      company_id: r.company_id,
      label: employeeNameLabel({
        full_name: r.full_name,
        display_name: r.profile?.display_name,
        username: r.profile?.username,
      }),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'th'));

  return NextResponse.json({ data: options });
}
