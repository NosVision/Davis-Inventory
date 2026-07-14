/**
 * import-leave-balances
 * ---------------------------------------------------------------------------
 * Imports per-employee vacation balances ("พักร้อนคงเหลือ") from the owner's
 * SALARY workbook into public.hr_leave_balances (per-employee quota overrides,
 * migration 00165). Each branch sheet carries two balance columns whose headers
 * embed a Buddhist-Era expiry, e.g. "พักร้อนคงเหลือ (สิ้นสุด 31 ธ.ค. 69)" =
 * BE 2569 = CE 2026; the column matching --year (BE = year + 543) is imported.
 * Rows with no name or no numeric balance are skipped; a balance of 0 IS
 * imported. Names are matched against hr_employees.full_name (fallback: the
 * linked profile's display_name/username) using the same normalization as
 * import-historical-payslips.
 *
 * The workbook is parsed with jszip (already a repo dependency — the repo has
 * no xlsx/exceljs reader; src/lib/xlsx.ts is a writer only).
 *
 * Usage:
 *   npx tsx scripts/import-leave-balances.ts --file=<xlsx path> --year=2026 --dry-run
 *   npx tsx scripts/import-leave-balances.ts --file=<xlsx path> --year=2026   # writes
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import JSZip from 'jszip';

if (existsSync('.env.local')) loadEnv({ path: '.env.local', override: true });

const args = process.argv.slice(2);
const filePath = args.find((a) => a.startsWith('--file='))?.slice('--file='.length);
const yearArg = args.find((a) => a.startsWith('--year='))?.slice('--year='.length);
const dryRun = args.includes('--dry-run');
const year = Number(yearArg ?? '2026');
if (!filePath || !existsSync(filePath)) {
  console.error('Missing/invalid --file=<xlsx path>');
  process.exit(1);
}
if (!Number.isInteger(year) || year < 2000 || year > 2100) {
  console.error('Invalid --year (expected CE year, e.g. 2026)');
  process.exit(1);
}
const beYear = year + 543; // 2026 → 2569
const beShort = String(beYear % 100).padStart(2, '0'); // '69'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

// --- name normalization (same as import-historical-payslips) ----------------
const PREFIX = /^(นางสาว|น\.ส\.|นาย|นาง|mr|mrs|ms|miss)\.?\s*/i;
function norm(name: string | null | undefined): string {
  if (!name) return '';
  let s = String(name).trim().toLowerCase();
  s = s.replace(PREFIX, '');
  return s.replace(/[\s.\-_]/g, '');
}

// --- minimal xlsx reader on top of jszip -------------------------------------
function unesc(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}
/** concat all <t> runs inside a fragment (handles rich text) */
function tText(frag: string): string {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(frag))) out += unesc(m[1]);
  return out;
}
function colLetterToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function indexToColLetter(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface SheetData {
  name: string;
  /** row(1-based) → col(0-based) → value */
  rows: Map<number, Map<number, string | number>>;
  maxRow: number;
}

async function loadWorkbook(path: string): Promise<SheetData[]> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const wbFile = zip.file('xl/workbook.xml');
  const relFile = zip.file('xl/_rels/workbook.xml.rels');
  if (!wbFile || !relFile) throw new Error('Not an xlsx workbook (missing workbook.xml)');
  const wbXml = await wbFile.async('string');
  const relXml = await relFile.async('string');

  const shared: string[] = [];
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    const ssXml = await ssFile.async('string');
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ssXml))) shared.push(tText(m[1]));
  }

  const rels = new Map<string, string>();
  {
    const re = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(relXml))) rels.set(m[1], m[2]);
  }

  const sheets: SheetData[] = [];
  const sre = /<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g;
  let sm: RegExpExecArray | null;
  while ((sm = sre.exec(wbXml))) {
    const name = unesc(sm[1]);
    let target = rels.get(sm[2]);
    if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const sheetFile = zip.file(target);
    if (!sheetFile) continue;
    const xml = await sheetFile.async('string');
    const rows = new Map<number, Map<number, string | number>>();
    let maxRow = 0;
    const cre = /<c\s+r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cre.exec(xml))) {
      const col = colLetterToIndex(cm[1]);
      const row = parseInt(cm[2], 10);
      const tAttr = /t="([^"]+)"/.exec(cm[3] ?? '')?.[1];
      const inner = cm[4] ?? '';
      let val: string | number | null = null;
      if (tAttr === 'inlineStr') val = tText(inner);
      else {
        const vm = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        if (vm) {
          const raw = unesc(vm[1]);
          if (tAttr === 's') val = shared[parseInt(raw, 10)] ?? null;
          else if (tAttr === 'str' || tAttr === 'e' || tAttr === 'b') val = raw;
          else {
            const n = Number(raw);
            val = Number.isFinite(n) ? n : raw;
          }
        }
      }
      if (val === null || val === '') continue;
      if (!rows.has(row)) rows.set(row, new Map());
      rows.get(row)!.set(col, val);
      if (row > maxRow) maxRow = row;
    }
    sheets.push({ name, rows, maxRow });
  }
  return sheets;
}

// --- sheet row extraction -----------------------------------------------------
interface SheetRow {
  sheet: string;
  rowNo: number;
  nameTH: string;
  nameEN: string;
  nick: string;
  pos: string;
  balance: number;
}

const HEADER_TEXT = 'พักร้อนคงเหลือ';

function findBalanceColumn(s: SheetData): { headerRow: number; col: number; headerText: string } | null {
  // header must contain พักร้อนคงเหลือ AND the target BE year as a standalone
  // 2-digit (…ธ.ค. 69) or 4-digit (2569) number.
  const beRe = new RegExp(`(?:^|[^0-9])(?:${beYear}|${beShort})(?:[^0-9]|$)`);
  for (const [r, cols] of s.rows) {
    for (const [c, v] of cols) {
      if (typeof v === 'string' && v.includes(HEADER_TEXT) && beRe.test(v)) {
        return { headerRow: r, col: c, headerText: v };
      }
    }
  }
  return null;
}

function extractRows(s: SheetData, headerRow: number, balCol: number): { rows: SheetRow[]; skippedNoBalance: number } {
  const rows: SheetRow[] = [];
  let skippedNoBalance = 0;
  const cell = (r: number, c: number): string | number | undefined => s.rows.get(r)?.get(c);
  const str = (r: number, c: number): string => {
    const v = cell(r, c);
    return v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  };
  for (let r = headerRow + 1; r <= s.maxRow; r++) {
    const nameTH = str(r, 1); // col B
    if (!nameTH) continue; // blank / section-divider rows (e.g. "ไม่เข้าประกันสังคม" sits in col A)
    const rawBal = cell(r, balCol);
    const bal = typeof rawBal === 'number' ? rawBal : rawBal != null && rawBal !== '' ? Number(rawBal) : NaN;
    if (!Number.isFinite(bal)) {
      skippedNoBalance++;
      continue; // no numeric balance for the target year → skip (0 is valid and kept)
    }
    rows.push({
      sheet: s.name,
      rowNo: r,
      nameTH,
      nameEN: str(r, 2), // col C
      nick: str(r, 3), // col D
      pos: str(r, 4), // col E
      balance: Math.round(bal * 10) / 10, // hr_leave_balances.quota_days is numeric(5,1)
    });
  }
  return { rows, skippedNoBalance };
}

// --- db types -----------------------------------------------------------------
interface Employee {
  id: string;
  profile_id: string;
  company_id: string | null;
  full_name: string | null;
  status: string;
}
interface Profile {
  id: string;
  display_name: string | null;
  username: string | null;
}

async function main() {
  console.log(`Target year: CE ${year} = BE ${beYear} (header suffix "${beShort}")`);
  console.log(`Workbook: ${filePath}`);

  const sheets = await loadWorkbook(filePath!);
  console.log(`Workbook sheets (${sheets.length}): ${sheets.map((s) => s.name).join(' | ')}`);

  // --- parse sheets ---
  const allRows: SheetRow[] = [];
  const perSheetHeader = new Map<string, string>();
  const perSheetSkipped = new Map<string, number>();
  for (const s of sheets) {
    const hit = findBalanceColumn(s);
    if (!hit) {
      console.log(`  [skip sheet] "${s.name}" — no "${HEADER_TEXT}" header matching BE ${beShort}`);
      continue;
    }
    perSheetHeader.set(s.name, `${indexToColLetter(hit.col)}${hit.headerRow}: ${hit.headerText}`);
    const { rows, skippedNoBalance } = extractRows(s, hit.headerRow, hit.col);
    perSheetSkipped.set(s.name, skippedNoBalance);
    allRows.push(...rows);
    console.log(
      `  [sheet] "${s.name}" balance col ${indexToColLetter(hit.col)} (header row ${hit.headerRow}) → ` +
        `${rows.length} row(s) with a numeric balance, ${skippedNoBalance} named row(s) without one`
    );
  }
  if (!allRows.length) {
    console.error('No balance rows found for the target year — nothing to import.');
    process.exit(1);
  }

  // --- load db reference data ---
  const [empRes, profRes, typeRes, coRes] = await Promise.all([
    db.from('hr_employees').select('id, profile_id, company_id, full_name, status'),
    db.from('profiles').select('id, display_name, username'),
    db.from('hr_leave_types').select('id, company_id, code').eq('code', 'vacation'),
    db.from('hr_companies').select('id, name'),
  ]);
  for (const [label, res] of [
    ['hr_employees', empRes],
    ['profiles', profRes],
    ['hr_leave_types', typeRes],
    ['hr_companies', coRes],
  ] as const) {
    if (res.error) throw new Error(`Failed to load ${label}: ${res.error.message}`);
  }
  const employees = (empRes.data ?? []) as Employee[];
  const profiles = new Map(((profRes.data ?? []) as Profile[]).map((p) => [p.id, p]));
  const vacationTypes = (typeRes.data ?? []) as { id: string; company_id: string | null; code: string }[];
  const companyName = new Map(((coRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  console.log(`\nLoaded ${employees.length} employees, ${profiles.size} profiles, ${vacationTypes.length} vacation leave type(s)`);
  for (const t of vacationTypes) {
    console.log(`  vacation type ${t.id} — company: ${t.company_id ? companyName.get(t.company_id) ?? t.company_id : '(shared/null)'}`);
  }

  // name index: normalized full_name + profile display_name/username → employees
  const nameIndex = new Map<string, Employee[]>();
  const add = (n: string, e: Employee) => {
    if (!n) return;
    const arr = nameIndex.get(n) ?? [];
    if (!arr.includes(e)) arr.push(e);
    nameIndex.set(n, arr);
  };
  for (const e of employees) {
    add(norm(e.full_name), e);
    const p = profiles.get(e.profile_id);
    add(norm(p?.display_name), e);
  }

  // vacation type per company: prefer company-scoped, else shared (company_id null)
  const sharedType = vacationTypes.find((t) => t.company_id === null) ?? null;
  const typeForCompany = (companyId: string | null): string | null => {
    if (companyId) {
      const scoped = vacationTypes.find((t) => t.company_id === companyId);
      if (scoped) return scoped.id;
    }
    return sharedType?.id ?? null;
  };

  // --- match ---
  interface PlanRow {
    employee_id: string;
    leave_type_id: string;
    year: number;
    quota_days: number;
    note: string;
  }
  const plan: PlanRow[] = [];
  const planMeta = new Map<string, { sheet: string; empName: string; company: string }>(); // employee_id → display info
  const unmatched: SheetRow[] = [];
  const ambiguous: { row: SheetRow; candidates: string[] }[] = [];
  const noLeaveType: { row: SheetRow; emp: Employee }[] = [];
  const dupPlan: { row: SheetRow; empName: string; firstSheet: string }[] = [];
  const matchedBySheet = new Map<string, number>();

  for (const row of allRows) {
    let cands = nameIndex.get(norm(row.nameTH)) ?? [];
    if (cands.length === 0 && row.nameEN) cands = nameIndex.get(norm(row.nameEN)) ?? [];

    if (cands.length > 1) {
      // tiebreak 1: nickname against profile display_name/username
      if (row.nick) {
        const n = norm(row.nick);
        const byNick = cands.filter((e) => {
          const p = profiles.get(e.profile_id);
          return norm(p?.display_name) === n || norm(p?.username) === n;
        });
        if (byNick.length === 1) cands = byNick;
      }
      // tiebreak 2: prefer active/probation
      if (cands.length > 1) {
        const active = cands.filter((e) => e.status === 'active' || e.status === 'probation');
        if (active.length === 1) cands = active;
      }
    }

    if (cands.length === 0) {
      unmatched.push(row);
      continue;
    }
    if (cands.length > 1) {
      ambiguous.push({
        row,
        candidates: cands.map(
          (e) => `${e.full_name ?? '?'} [${e.status}] (${e.company_id ? companyName.get(e.company_id) ?? '?' : 'no company'})`
        ),
      });
      continue;
    }

    const emp = cands[0];
    const leaveTypeId = typeForCompany(emp.company_id);
    if (!leaveTypeId) {
      noLeaveType.push({ row, emp });
      continue;
    }

    const prior = planMeta.get(emp.id);
    if (prior) {
      // same employee already planned from another row/sheet — keep the first, report
      dupPlan.push({ row, empName: emp.full_name ?? row.nameTH, firstSheet: prior.sheet });
      continue;
    }

    plan.push({
      employee_id: emp.id,
      leave_type_id: leaveTypeId,
      year,
      quota_days: row.balance,
      note: `sheet import: พักร้อนคงเหลือ สิ้นสุด ธ.ค. ${beShort} (${row.sheet})`,
    });
    planMeta.set(emp.id, {
      sheet: row.sheet,
      empName: emp.full_name ?? row.nameTH,
      company: emp.company_id ? companyName.get(emp.company_id) ?? emp.company_id : '(no company)',
    });
    matchedBySheet.set(row.sheet, (matchedBySheet.get(row.sheet) ?? 0) + 1);
  }

  // --- report ---
  console.log('\n=== COLUMN MAPPING ===');
  for (const [sheet, header] of perSheetHeader) console.log(`  ${sheet}: ${header}`);

  console.log('\n=== MATCH SUMMARY ===');
  console.log(`sheet rows with balance: ${allRows.length}`);
  for (const [sheet] of perSheetHeader) {
    const total = allRows.filter((r) => r.sheet === sheet).length;
    console.log(`  ${sheet}: ${matchedBySheet.get(sheet) ?? 0}/${total} matched`);
  }
  console.log(`planned upserts:   ${plan.length}`);
  console.log(`unmatched:         ${unmatched.length}`);
  console.log(`ambiguous:         ${ambiguous.length}`);
  console.log(`no leave type:     ${noLeaveType.length}`);
  console.log(`duplicate planned: ${dupPlan.length}`);

  console.log('\n=== PLAN (sheet → employee (company) → quota_days) ===');
  for (const p of plan) {
    const m = planMeta.get(p.employee_id)!;
    console.log(`  ${m.sheet.padEnd(15)} | ${m.empName.padEnd(40)} | ${m.company.padEnd(30)} | ${p.quota_days}`);
  }

  if (unmatched.length) {
    console.log('\n=== UNMATCHED (no hr_employee by normalized name) ===');
    for (const u of unmatched) console.log(`  ${u.sheet} R${u.rowNo}: ${u.nameTH}${u.pos ? ` (${u.pos})` : ''} → balance ${u.balance}`);
  }
  if (ambiguous.length) {
    console.log('\n=== AMBIGUOUS (multiple employees share the normalized name) ===');
    for (const a of ambiguous) {
      console.log(`  ${a.row.sheet} R${a.row.rowNo}: ${a.row.nameTH} → balance ${a.row.balance}`);
      for (const c of a.candidates) console.log(`      candidate: ${c}`);
    }
  }
  if (noLeaveType.length) {
    console.log('\n=== NO VACATION LEAVE TYPE for employee company ===');
    for (const n of noLeaveType) {
      console.log(
        `  ${n.row.sheet} R${n.row.rowNo}: ${n.row.nameTH} → company ${n.emp.company_id ? companyName.get(n.emp.company_id) ?? n.emp.company_id : '(none)'}`
      );
    }
  }
  if (dupPlan.length) {
    console.log('\n=== DUPLICATE (employee already planned from an earlier row — kept first) ===');
    for (const d of dupPlan) console.log(`  ${d.row.sheet} R${d.row.rowNo}: ${d.empName} (first planned from ${d.firstSheet})`);
  }

  if (dryRun) {
    console.log('\n[DRY RUN] no rows written.');
    return;
  }

  if (!plan.length) {
    console.log('\nNothing to upsert.');
    return;
  }
  let upserted = 0;
  for (let i = 0; i < plan.length; i += 200) {
    const chunk = plan.slice(i, i + 200);
    const { error } = await db
      .from('hr_leave_balances')
      .upsert(chunk, { onConflict: 'employee_id,leave_type_id,year' });
    if (error) throw error;
    upserted += chunk.length;
    console.log(`upserted ${upserted}/${plan.length}`);
  }
  console.log(`\nDONE. Upserted ${upserted} hr_leave_balances rows for year ${year}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
