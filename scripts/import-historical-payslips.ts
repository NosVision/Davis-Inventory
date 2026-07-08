/**
 * import-historical-payslips
 * ---------------------------------------------------------------------------
 * Loads the legacy monthly pay figures (Jan–Jun 2026, 4 branches) parsed from
 * the Payment spreadsheets into public.hr_imported_payslips — a read-only
 * archive. Each slip is matched to an existing hr_pending_identities row by
 * normalized name (inheriting that identity's company_id); unmatched rows are
 * still stored, keyed to the branch's company by sheet tag, with a null
 * pending_identity_id so they can be linked later.
 *
 * The parsed data file lives OUTSIDE the repo (it carries salary PII). Pass its
 * path with --data=<abs path to allslips.json>.
 *
 * Usage:
 *   npx tsx scripts/import-historical-payslips.ts --data=<path> --dry-run
 *   npx tsx scripts/import-historical-payslips.ts --data=<path>        # writes
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';

if (existsSync('.env.local')) loadEnv({ path: '.env.local', override: true });

const args = process.argv.slice(2);
const dataPath = args.find((a) => a.startsWith('--data='))?.slice('--data='.length);
const dryRun = args.includes('--dry-run');
if (!dataPath || !existsSync(dataPath)) {
  console.error('Missing/invalid --data=<abs path to allslips.json>');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

// --- types -----------------------------------------------------------------
interface Slip {
  tag: string; no: string; nameTH: string; nameEN: string; nick: string; pos: string;
  salary: number | null; start: string; resign: string;
  wday: number | null; woff: number | null; wtot: number | null; totsal: number | null;
  SL: number | null; SLX: number | null; PL: number | null; PLX: number | null;
  VL: number | null; VLX: number | null; H: number | null; AB: number | null;
  LWPd: number | null; SLWd: number | null; OT: number | null;
  daily: number | null; payot: number | null; holpay: number | null;
  transp: number | null; payptrans: number | null;
  dAB: number | null; dLWP: number | null; dSLW: number | null; dOther: number | null;
  total: number | null; ss5: number | null; ss3: number | null; tax: number | null;
  net: number | null; service: number | null; bank: string; remark: string;
  year: number; month: number;
}
interface Identity { id: string; company_id: string; full_name_th: string | null; full_name_en: string | null; rate_satang: number | null; sheet_ref: string | null; }

// --- helpers ---------------------------------------------------------------
const PREFIX = /^(นางสาว|น\.ส\.|นาย|นาง|mr|mrs|ms|miss)\.?\s*/i;
function norm(name: string | null | undefined): string {
  if (!name) return '';
  let s = String(name).trim().toLowerCase();
  s = s.replace(PREFIX, '');
  return s.replace(/[\s.\-_]/g, '');
}
const sat = (baht: number | null | undefined): number | null =>
  baht === null || baht === undefined ? null : Math.round(baht * 100);
const jnum = (v: number | null | undefined) => (v === null || v === undefined ? null : v);

async function main() {
  const slips: Slip[] = JSON.parse(readFileSync(dataPath!, 'utf8'));
  console.log(`Loaded ${slips.length} parsed slips from ${dataPath}`);

  // load identities
  const { data: ids, error } = await db
    .from('hr_pending_identities')
    .select('id, company_id, full_name_th, full_name_en, rate_satang, sheet_ref');
  if (error) throw error;
  const identities = (ids ?? []) as Identity[];
  console.log(`Loaded ${identities.length} pending identities`);

  // tag -> company_id (authoritative, from existing identity sheet_refs)
  const tagCompany = new Map<string, string>();
  for (const it of identities) {
    const t = it.sheet_ref?.split('#')[0];
    if (t && !tagCompany.has(t)) tagCompany.set(t, it.company_id);
  }
  console.log('Branch tag → company map:', Object.fromEntries(tagCompany));

  // name index: normalized TH and EN both point at the identity
  const nameIndex = new Map<string, Identity[]>();
  const add = (n: string, it: Identity) => {
    if (!n) return;
    const arr = nameIndex.get(n) ?? [];
    if (!arr.includes(it)) arr.push(it);
    nameIndex.set(n, arr);
  };
  for (const it of identities) { add(norm(it.full_name_th), it); add(norm(it.full_name_en), it); }

  // match
  let matched = 0, ambiguousResolved = 0, unmatched = 0, noCompany = 0;
  const unmatchedSamples: string[] = [];
  const perTagUnmatched = new Map<string, number>();
  const rows: Record<string, unknown>[] = [];

  for (const s of slips) {
    const tagCo = tagCompany.get(s.tag) ?? null;
    let cands = nameIndex.get(norm(s.nameTH)) ?? [];
    if (cands.length === 0) cands = nameIndex.get(norm(s.nameEN)) ?? [];

    let identity: Identity | null = null;
    if (cands.length === 1) { identity = cands[0]; matched++; }
    else if (cands.length > 1) {
      // tiebreak: same branch company, then nearest salary
      let pool = tagCo ? cands.filter((c) => c.company_id === tagCo) : cands;
      if (pool.length === 0) pool = cands;
      if (pool.length > 1 && s.salary != null) {
        pool = [...pool].sort(
          (a, b) => Math.abs((a.rate_satang ?? 0) - s.salary! * 100) - Math.abs((b.rate_satang ?? 0) - s.salary! * 100),
        );
      }
      identity = pool[0];
      matched++; ambiguousResolved++;
    } else {
      unmatched++;
      perTagUnmatched.set(s.tag, (perTagUnmatched.get(s.tag) ?? 0) + 1);
      if (unmatchedSamples.length < 12) unmatchedSamples.push(`${s.tag} ${s.year}-${s.month} #${s.no} ${s.nick || s.nameTH}`);
    }

    const companyId = identity?.company_id ?? tagCo;
    if (!companyId) { noCompany++; continue; } // cannot store without a company

    // delta between this slip's salary and the matched identity's rate — used to
    // resolve within-month collisions (two slips matching one identity): keep the
    // closest, demote the rest to unlinked so no pay history is lost.
    const delta = identity && s.salary != null
      ? Math.abs((identity.rate_satang ?? 0) - s.salary * 100)
      : Number.MAX_SAFE_INTEGER;

    rows.push({
      __idkey: identity ? `${identity.id}|${s.year}|${s.month}` : null,
      __delta: delta,
      company_id: companyId,
      pending_identity_id: identity?.id ?? null,
      period_year: s.year,
      period_month: s.month,
      source: 'sheet_import',
      sheet_ref: `${s.tag}#${s.no}`,
      name_th: s.nameTH || null,
      name_en: s.nameEN || null,
      nickname: s.nick || null,
      position_text: s.pos || null,
      rate_satang: sat(s.salary),
      worked_days: jnum(s.wday),
      off_days: jnum(s.woff),
      period_days: jnum(s.wtot),
      ot_hours: jnum(s.OT),
      ot_pay_satang: sat(s.payot),
      holiday_pay_satang: sat(s.holpay),
      transportation_satang: sat(s.transp),
      pay_transportation_satang: sat(s.payptrans),
      service_satang: sat(s.service),
      leaves: {
        sl: s.SL, slx: s.SLX, pl: s.PL, plx: s.PLX, vl: s.VL, vlx: s.VLX,
        h: s.H, ab: s.AB, lwp: s.LWPd, slw: s.SLWd,
      },
      deduction_satang: sat((s.dAB ?? 0) + (s.dLWP ?? 0) + (s.dSLW ?? 0) + (s.dOther ?? 0)),
      deduction_breakdown: { ab_late: s.dAB, lwp: s.dLWP, slw: s.dSLW, other: s.dOther },
      gross_satang: sat(s.total),
      sso5_satang: sat(s.ss5),
      sso3_satang: sat(s.ss3),
      tax_satang: sat(s.tax),
      net_satang: sat(s.net),
      raw: s,
    });
  }

  // resolve within-month identity collisions: for each (identity, year, month)
  // keep the row with the smallest salary delta linked, unlink the others.
  const best = new Map<string, { delta: number }>();
  for (const r of rows) {
    const k = r.__idkey as string | null;
    if (!k) continue;
    const cur = best.get(k);
    if (!cur || (r.__delta as number) < cur.delta) best.set(k, { delta: r.__delta as number });
  }
  let demoted = 0;
  const claimed = new Set<string>();
  for (const r of rows) {
    const k = r.__idkey as string | null;
    if (!k) continue;
    if ((r.__delta as number) === best.get(k)!.delta && !claimed.has(k)) {
      claimed.add(k); // this row keeps the link
    } else {
      r.pending_identity_id = null; demoted++;
    }
  }
  // strip scratch fields before insert
  for (const r of rows) { delete r.__idkey; delete r.__delta; }
  const linked = rows.filter((r) => r.pending_identity_id).length;

  console.log('\n=== MATCH SUMMARY ===');
  console.log(`collision-demoted:  ${demoted}  | finally linked rows: ${linked}`);
  console.log(`matched:            ${matched}  (of which ambiguous-resolved: ${ambiguousResolved})`);
  console.log(`unmatched (no id):  ${unmatched}`);
  console.log(`dropped (no company): ${noCompany}`);
  console.log(`rows to insert:     ${rows.length}`);
  console.log('unmatched per branch tag:', Object.fromEntries(perTagUnmatched));
  if (unmatchedSamples.length) { console.log('unmatched samples:'); unmatchedSamples.forEach((u) => console.log('  -', u)); }

  if (dryRun) { console.log('\n[DRY RUN] no rows written.'); return; }

  // idempotent: clear prior sheet imports, then insert fresh
  const del = await db.from('hr_imported_payslips').delete().eq('source', 'sheet_import');
  if (del.error) throw del.error;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error: insErr } = await db.from('hr_imported_payslips').insert(chunk);
    if (insErr) throw insErr;
    inserted += chunk.length;
    console.log(`inserted ${inserted}/${rows.length}`);
  }
  console.log(`\nDONE. Inserted ${inserted} historical payslip rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
