// Idempotent seed for HR test users (LOOP-PLAN rule 8). Reads secrets from .env.local.
// Run from repo root: node scripts/seed-hr-test-users.mjs
// Writes credentials to f:/tmp/hr-test-creds.json (outside repo — never committed).
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
console.log('Target Supabase project:', new URL(url).host); // awareness — verify before seeding

const TEST_STORE = { code: 'HRTEST', name: 'HR Test Venue' };

const USERS = [
  { username: 'hr-test-owner', role: 'owner', display: 'HR Test Owner' },
  { username: 'hr-test-hr', role: 'staff', display: 'HR Test HR', canManageHr: true },
  { username: 'hr-test-manager', role: 'manager', display: 'HR Test Manager' },
  { username: 'hr-test-staff', role: 'staff', display: 'HR Test Staff 8+1',
    emp: { pay_type: 'full_monthly', work_hours_per_day: 8, break_hours: 1, ot_eligible: true, ot_hour_divisor: 8, rate_satang: 1800000 } },
  { username: 'hr-test-staff9', role: 'staff', display: 'HR Test Staff 9+1',
    emp: { pay_type: 'full_monthly', work_hours_per_day: 9, break_hours: 1, ot_eligible: true, ot_hour_divisor: 9, rate_satang: 2100000 } },
  { username: 'hr-test-parttime', role: 'staff', display: 'HR Test Part-time',
    emp: { pay_type: 'pt_hourly', work_hours_per_day: 8, break_hours: 1, ot_eligible: false, ot_hour_divisor: 8, tax_mode: 'withholding_3pct', sso_enrolled: false, rate_satang: 6000 } },
];

function genPassword() {
  return 'Hr9!' + randomBytes(6).toString('hex'); // 16 chars, mixed classes
}

async function findUserByEmail(email) {
  // paginate admin list to find an existing user (idempotent re-runs)
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  return null;
}

async function ensureStore() {
  const { data: existing } = await svc.from('stores').select('id').eq('store_code', TEST_STORE.code).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await svc.from('stores')
    .insert({ store_code: TEST_STORE.code, store_name: TEST_STORE.name, active: true, is_central: false })
    .select('id').single();
  if (error) throw error;
  return data.id;
}

async function run() {
  const storeId = await ensureStore();
  console.log('Test store id:', storeId);
  const creds = { store: { ...TEST_STORE, id: storeId }, note: 'HR test accounts — never commit. Login uses username; email = <username>@stockmanager.app', users: [] };

  for (const u of USERS) {
    const email = `${u.username}@stockmanager.app`;
    const password = genPassword();
    let userId;

    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { username: u.username, role: u.role },
    });
    if (createErr) {
      if (String(createErr.message).includes('already been registered')) {
        const existing = await findUserByEmail(email);
        if (!existing) throw new Error(`User ${email} exists but not found via list`);
        userId = existing.id;
        await svc.auth.admin.updateUserById(userId, { password }); // reset to known password
        console.log(`~ reused ${u.username} (${userId})`);
      } else {
        throw createErr;
      }
    } else {
      userId = created.user.id;
      console.log(`+ created ${u.username} (${userId})`);
    }

    // profile (trigger creates the row on auth insert; update role/username/active)
    await svc.from('profiles').update({
      username: u.username, role: u.role, display_name: u.display, active: true,
    }).eq('id', userId);

    // store link (all test users belong to the test venue)
    await svc.from('user_stores').upsert({ user_id: userId, store_id: storeId }, { onConflict: 'user_id,store_id' });

    // can_manage_hr grant
    if (u.canManageHr) {
      const { data: hasPerm } = await svc.from('user_permissions')
        .select('id').eq('user_id', userId).eq('permission', 'can_manage_hr').maybeSingle();
      if (!hasPerm) {
        await svc.from('user_permissions').insert({ user_id: userId, permission: 'can_manage_hr', granted_by: userId });
      }
    }

    // hr_employees time profile (upsert on profile_id)
    if (u.emp) {
      await svc.from('hr_employees').upsert(
        { profile_id: userId, status: 'active', ...u.emp },
        { onConflict: 'profile_id' }
      );
    }

    creds.users.push({ username: u.username, email, password, role: u.role, id: userId, canManageHr: !!u.canManageHr, emp: u.emp || null });
  }

  const out = 'f:/tmp/hr-test-creds.json';
  writeFileSync(out, JSON.stringify(creds, null, 2));
  console.log(`\nWrote ${creds.users.length} credentials to ${out} (passwords not echoed to stdout)`);
  console.log('Usernames:', creds.users.map((c) => c.username).join(', '));
}

run().catch((e) => { console.error('SEED FAILED:', e); process.exit(1); });
