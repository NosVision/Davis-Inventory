/* eslint-disable no-console */
/**
 * reset-hr-test-data
 * ---------------------------------------------------------------------------
 * Wipe the HR module's TRANSACTIONAL rows (punches, rosters, leaves, requests,
 * payruns, pools, evaluations, audit, HR notifications) while keeping every
 * CONFIGURATION row (companies, positions, departments, leave types, locations,
 * shift templates, manager scopes, payroll groups, recurring pay items, leave
 * balances, employees, imported payslips, pending identities, registration links).
 *
 * HR asked for this before announcing the system to staff (คุณเมย์ 2026-09-08:
 * "เมเล่นเละเทะไว้ ล้างข้อมูลได้ไหม แต่พวกตั้งค่าปิดไว้ต่างๆ ก็จะคืนค่าถูกไหม").
 *
 * Safe by default:
 *   • dry-run unless --yes is passed — prints how many rows each table would lose
 *   • every matched row is dumped to hr-reset-backup/<timestamp>/<table>.json first
 *   • employees are never deleted; --reactivate-offboarded only re-opens people whose
 *     resignation was recorded inside the wiped window (listed before it runs)
 *
 * Usage:
 *   npx tsx scripts/reset-hr-test-data.ts                       # dry run, everything
 *   npx tsx scripts/reset-hr-test-data.ts --before=2026-09-22   # rows dated before go-live
 *   npx tsx scripts/reset-hr-test-data.ts --before=2026-09-22 --yes
 *
 *   --company=<hr_companies.id>   limit to one company where the table carries company_id
 *   --keep-finalized              leave finalized payruns / pools untouched
 *   --reactivate-offboarded       set hr_employees back to active where an offboarding in
 *                                 the wiped window had marked them resigned/terminated
 *   --no-backup                   skip the JSON dump (not recommended)
 *   --notifications               also wipe HR in-app notifications (needs the type index, see below)
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */

import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';

if (existsSync('.env.local')) loadEnv({ path: '.env.local', override: true });

// ---------------------------------------------------------------------------
// What gets wiped, in dependency order (children before parents; cascades noted)
// ---------------------------------------------------------------------------

interface Target {
  table: string;
  /** Column compared against --before (ISO date or timestamp). */
  dateColumn: string;
  /** Column that carries the company, when the table has one. */
  companyColumn?: string;
  /** Extra filter applied on top of date/company. */
  where?: { column: string; op: 'eq' | 'neq' | 'like'; value: string };
  /** Status column for --keep-finalized. */
  finalizedColumn?: string;
  note?: string;
}

const TARGETS: Target[] = [
  // Attendance
  { table: 'hr_attendance_requests', dateColumn: 'business_date' },
  { table: 'hr_attendance_reminders', dateColumn: 'business_date' },
  { table: 'hr_timesheet_overrides', dateColumn: 'business_date' },
  { table: 'hr_attendance', dateColumn: 'business_date' },
  { table: 'hr_ot_requests', dateColumn: 'work_date' },
  // Roster & leave
  { table: 'hr_dayoff_swaps', dateColumn: 'requester_date' },
  { table: 'hr_leaves', dateColumn: 'from_date', companyColumn: 'company_id' },
  { table: 'hr_schedule', dateColumn: 'work_date', companyColumn: 'company_id' },
  // People-process requests
  { table: 'hr_profile_change_requests', dateColumn: 'created_at' },
  { table: 'hr_document_requests', dateColumn: 'created_at' },
  { table: 'hr_claims', dateColumn: 'claim_date', companyColumn: 'company_id' },
  { table: 'hr_warnings', dateColumn: 'issued_at', companyColumn: 'company_id', note: 'signatures cascade' },
  { table: 'hr_resignation_requests', dateColumn: 'created_at', companyColumn: 'company_id' },
  { table: 'hr_offboarding', dateColumn: 'created_at', companyColumn: 'company_id', note: 'assets cascade' },
  // Money
  {
    table: 'hr_payruns', dateColumn: 'created_at', companyColumn: 'company_id', finalizedColumn: 'status',
    note: 'payslips, earnings, deductions, bonuses, adjustments, remarks, review links, tax overrides, print requests cascade',
  },
  { table: 'hr_sc_pools', dateColumn: 'created_at', finalizedColumn: 'status', note: 'allocations + deductions cascade' },
  { table: 'hr_tip_pools', dateColumn: 'created_at', finalizedColumn: 'status', note: 'allocations + deductions cascade' },
  { table: 'hr_eval_periods', dateColumn: 'created_at', finalizedColumn: 'status', note: 'assignments, scores, results, payouts cascade' },
  // Acknowledgements & trail
  { table: 'hr_policy_acknowledgements', dateColumn: 'acked_at' },
  { table: 'hr_announcement_receipts', dateColumn: 'updated_at' },
  { table: 'hr_audit_log', dateColumn: 'created_at' },
];

// notifications holds ~640k deposit/withdrawal rows and no index on `type`; a `type like 'hr_%'`
// scan took 16.7 s on 2026-09-19, past PostgREST's 8 s statement timeout, so this table is opt-in
// (--notifications) and only sensible once migration 20260919130000_notifications_type_idx.sql
// has been applied.
const NOTIFICATIONS_TARGET: Target = {
  table: 'notifications', dateColumn: 'created_at', where: { column: 'type', op: 'like', value: 'hr_%' },
  note: 'HR in-app notifications only',
};

const KEPT = [
  'hr_companies', 'hr_positions', 'hr_departments', 'hr_locations', 'hr_leave_types', 'hr_holidays',
  'hr_shift_templates', 'hr_manager_scopes', 'hr_payroll_groups', 'hr_payroll_group_managers',
  'hr_employees', 'hr_employee_recurring', 'hr_leave_balances', 'hr_pending_leave_balances',
  'hr_tax_allowances', 'hr_ytd_opening', 'hr_imported_payslips', 'hr_pending_identities',
  'hr_registration_links', 'hr_policies', 'hr_policy_settings', 'hr_announcements', 'hr_assets',
  'hr_eval_assignment_templates', 'hr_message_templates', 'hr_checklist_responses',
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
  yes: boolean;
  before: string | null;
  company: string | null;
  keepFinalized: boolean;
  reactivateOffboarded: boolean;
  backup: boolean;
  notifications: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    yes: false, before: null, company: null, keepFinalized: false, reactivateOffboarded: false, backup: true, notifications: false,
  };
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.split('=');
    switch (key) {
      case '--yes': args.yes = true; break;
      case '--before':
        if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('--before expects YYYY-MM-DD');
        args.before = value;
        break;
      case '--company': args.company = value ?? null; break;
      case '--keep-finalized': args.keepFinalized = true; break;
      case '--reactivate-offboarded': args.reactivateOffboarded = true; break;
      case '--no-backup': args.backup = false; break;
      case '--notifications': args.notifications = true; break;
      default: throw new Error(`Unknown flag ${raw}`);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Service = SupabaseClient;
type Row = Record<string, unknown>;

// The PostgREST builder is chainable; typed loosely here because each table differs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(query: any, target: Target, args: Args) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = query;
  if (args.before) q = q.lt(target.dateColumn, args.before);
  if (args.company && target.companyColumn) q = q.eq(target.companyColumn, args.company);
  if (target.where) {
    if (target.where.op === 'like') q = q.like(target.where.column, target.where.value);
    else if (target.where.op === 'eq') q = q.eq(target.where.column, target.where.value);
    else q = q.neq(target.where.column, target.where.value);
  }
  if (args.keepFinalized && target.finalizedColumn) q = q.neq(target.finalizedColumn, 'finalized');
  return q;
}

async function countRows(service: Service, target: Target, args: Args): Promise<number> {
  const { count, error } = await applyFilters(
    service.from(target.table).select('*', { count: 'exact', head: true }),
    target,
    args
  );
  if (error) throw new Error(`${target.table}: ${error.message}`);
  return count ?? 0;
}

async function fetchRows(service: Service, target: Target, args: Args): Promise<Row[]> {
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await applyFilters(service.from(target.table).select('*'), target, args)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${target.table}: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) return rows;
  }
}

async function deleteRows(service: Service, target: Target, args: Args): Promise<void> {
  // PostgREST refuses an unfiltered delete; `id is not null` is the explicit "all rows" filter.
  const base = service.from(target.table).delete().not('id', 'is', null);
  const { error } = await applyFilters(base, target, args);
  if (error) throw new Error(`${target.table}: ${error.message}`);
}

async function offboardedInWindow(service: Service, args: Args): Promise<{ id: string; full_name: string | null; end_date: string | null }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = service
    .from('hr_employees')
    .select('id, full_name, end_date, status, company_id')
    .in('status', ['resigned', 'terminated']);
  if (args.before) q = q.lt('end_date', args.before);
  if (args.company) q = q.eq('company_id', args.company);
  const { data, error } = await q;
  if (error) throw new Error(`hr_employees: ${error.message}`);
  return (data ?? []) as { id: string; full_name: string | null; end_date: string | null }[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const service = createClient(url, key, { auth: { persistSession: false } });

  console.log(`Target: ${url}`);
  console.log(`Mode:   ${args.yes ? 'EXECUTE' : 'dry run'}${args.before ? ` · rows before ${args.before}` : ' · ALL rows'}${args.company ? ` · company ${args.company}` : ''}${args.keepFinalized ? ' · keeping finalized' : ''}`);
  console.log(`Kept as configuration: ${KEPT.join(', ')}`);
  console.log('');

  const targets = args.notifications ? [...TARGETS, NOTIFICATIONS_TARGET] : TARGETS;
  const plan: { target: Target; count: number }[] = [];
  for (const target of targets) {
    const count = await countRows(service, target, args);
    plan.push({ target, count });
    console.log(`${target.table.padEnd(30)} ${String(count).padStart(7)}${target.note ? `   (${target.note})` : ''}`);
  }

  const offboarded = args.reactivateOffboarded ? await offboardedInWindow(service, args) : [];
  if (args.reactivateOffboarded) {
    console.log('');
    console.log(`Employees to reactivate (${offboarded.length}):`);
    for (const e of offboarded) console.log(`  ${e.full_name ?? e.id}  end_date=${e.end_date ?? '—'}`);
  }

  if (!args.yes) {
    console.log('');
    console.log('Dry run only. Re-run with --yes to delete.');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join('hr-reset-backup', stamp);
  if (args.backup) {
    await mkdir(backupDir, { recursive: true });
    console.log('');
    console.log(`Backing up matched rows to ${backupDir}`);
  }

  for (const { target, count } of plan) {
    if (count === 0) continue;
    if (args.backup) {
      const rows = await fetchRows(service, target, args);
      await writeFile(join(backupDir, `${target.table}.json`), JSON.stringify(rows, null, 2), 'utf8');
    }
    await deleteRows(service, target, args);
    console.log(`deleted ${target.table} (${count})`);
  }

  if (offboarded.length > 0) {
    const { error } = await service
      .from('hr_employees')
      .update({ status: 'active', end_date: null, end_reason: null })
      .in('id', offboarded.map((e) => e.id));
    if (error) throw new Error(`hr_employees reactivate: ${error.message}`);
    console.log(`reactivated ${offboarded.length} employees`);
  }

  console.log('');
  console.log('Done. Configuration tables untouched.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
