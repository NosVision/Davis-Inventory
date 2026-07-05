#!/usr/bin/env node
/**
 * Import payroll-sheet employees into hr_pending_identities (the identity-claim staging table,
 * 00115) + seed the 4 real hr_companies. Reads the extracted sheet JSONs from F:/tmp (PII stays
 * off-repo; this script contains no personal data itself).
 *
 *   node scripts/hr-import-identities.cjs            → DRY RUN (prints per-venue counts)
 *   node scripts/hr-import-identities.cjs --apply    → upserts companies + identities
 *
 * Per row: full_name_th, position_text, rate (SALARY), start_date (STARTING), sso/tax from the
 * actual deduction columns (SS 5% present → sso_enrolled; SS 3% present → withholding_3pct, no
 * SSO — matches the sheet's real behaviour pending the accountant's answer to question 3).
 * Rows with a RESIGNED date are SKIPPED (importing leavers is pointless for claiming).
 * Idempotent: unique (company_id, full_name_th) upsert; re-runs update the seed fields of
 * still-unclaimed rows only (claimed/linked rows are never touched).
 */
const fs = require('fs');
const path = require('path');
require(require.resolve('dotenv', { paths: ['F:/Davis-Inventory'] })).config({ path: 'F:/Davis-Inventory/.env.local' });
const { createClient } = require(require.resolve('@supabase/supabase-js', { paths: ['F:/Davis-Inventory'] }));

const APPLY = process.argv.includes('--apply');
const DIR = 'F:/tmp/payment-june-2026';

const SHEETS = [
  { json: '0-Baccarat.json', store: 'Baccarat', company: 'บริษัท บัคคารัต บางกอก บาร์ และ เรสเทอรเริน จำกัด', ref: 'Baccarat' },
  { json: '1-24_Amore.json', store: '24 BLVD', company: 'บริษัท ทรัพย์สินตระการตา จำกัด', ref: '24Amore' },
  { json: '2-Upper_House.json', store: 'Upper House', company: 'บริษัท อัพเปอร์ เฮ้าส์ จำกัด', ref: 'UpperHouse' },
  { json: '3-House_of_Savoy.json', store: 'House of Savoy', company: 'บริษัท เฮ้าส์ ออฟ ซาวอย จำกัด', ref: 'Savoy' },
];

// Thai month abbreviations → month number (sheet STARTING style: "8-มิ.ย.-24" or serial dates)
const TH_MONTHS = { 'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12 };
function parseStart(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    // Excel serial date (days since 1899-12-30)
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})-(.+?)-(\d{2,4})$/);
  if (m && TH_MONTHS[m[2]]) {
    let y = Number(m[3]);
    y = y < 100 ? 2000 + y : y; // "24" → 2024 (sheet uses CE short years)
    if (y > 2400) y -= 543; // Buddhist-era safety
    return `${y}-${String(TH_MONTHS[m[2]]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}
const num = (v) => {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

function extract(sheet) {
  const { rows } = JSON.parse(fs.readFileSync(path.join(DIR, sheet.json), 'utf8'));
  const findRow = (needle) => rows.findIndex((r) => r.some((c) => String(c || '').includes(needle)));
  const hdrName = rows[findRow('NAME - SURNAME (TH)')] || [];
  const hdrMoney = rows[findRow('SS 5%')] || [];
  const col = (hdr, needle) => hdr.findIndex((c) => String(c || '').includes(needle));
  const iName = col(hdrName, 'NAME - SURNAME (TH)');
  const iPos = col(hdrName, 'Position') >= 0 ? col(hdrName, 'Position') : col(hdrName, 'Team');
  const iSalary = col(hdrName, 'SALARY');
  const iStart = col(hdrName, 'STARTING');
  const iResigned = col(hdrName, 'RESIGNED');
  const iSS5 = col(hdrMoney, 'SS 5%');
  const iSS3 = col(hdrMoney, 'SS 3%');

  const out = [];
  let skippedResigned = 0;
  for (const r of rows) {
    const no = Number(r[0]);
    if (!Number.isInteger(no) || no <= 0 || no > 500) continue;
    const name = String(r[iName] ?? '').trim().replace(/\s+/g, ' ');
    if (!name || name.length < 3) continue;
    if (iResigned >= 0 && r[iResigned] != null && String(r[iResigned]).trim() !== '') {
      skippedResigned++;
      continue;
    }
    const ss5 = num(r[iSS5]);
    const ss3 = num(r[iSS3]);
    out.push({
      no,
      full_name_th: name,
      position_text: String(r[iPos] ?? '').trim() || null,
      rate_satang: Math.round(num(r[iSalary]) * 100),
      start_date: parseStart(r[iStart]),
      sso_enrolled: ss5 > 0,
      tax_mode: ss3 > 0 ? 'withholding_3pct' : 'progressive',
      sheet_ref: `${sheet.ref}#${no}`,
    });
  }
  return { out, skippedResigned };
}

(async () => {
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: stores } = await svc.from('stores').select('id, store_name');
  const storeId = (name) => (stores ?? []).find((s) => s.store_name === name)?.id ?? null;

  let totIns = 0, totUpd = 0, totSkip = 0;
  for (const sheet of SHEETS) {
    const { out, skippedResigned } = extract(sheet);
    console.log(`\n${sheet.ref}: ${out.length} active rows (skipped ${skippedResigned} resigned) → company "${sheet.company}"`);
    const sso = out.filter((r) => r.sso_enrolled).length;
    const w3 = out.filter((r) => r.tax_mode === 'withholding_3pct').length;
    const noStart = out.filter((r) => !r.start_date).length;
    console.log(`  sso_enrolled=${sso} · 3%=${w3} · missing start_date=${noStart} · sample: ${out[0]?.sheet_ref} rate=${out[0]?.rate_satang / 100}`);
    if (!APPLY) continue;

    // company upsert by name
    let { data: co } = await svc.from('hr_companies').select('id').eq('name', sheet.company).maybeSingle();
    if (!co) {
      const ins = await svc.from('hr_companies').insert({ name: sheet.company, active: true }).select('id').single();
      if (ins.error) { console.error('  company insert FAILED:', ins.error.message); process.exit(1); }
      co = ins.data;
      console.log('  company created');
    }
    const sid = storeId(sheet.store);

    for (const r of out) {
      const row = { company_id: co.id, store_id: sid, ...r };
      delete row.no;
      const { data: existing } = await svc
        .from('hr_pending_identities')
        .select('id, status')
        .eq('company_id', co.id)
        .eq('full_name_th', r.full_name_th)
        .maybeSingle();
      if (!existing) {
        const ins = await svc.from('hr_pending_identities').insert(row);
        if (ins.error) { console.error(`  insert FAILED ${r.sheet_ref}:`, ins.error.message); totSkip++; }
        else totIns++;
      } else if (existing.status === 'unclaimed') {
        const upd = await svc.from('hr_pending_identities').update(row).eq('id', existing.id).eq('status', 'unclaimed');
        if (upd.error) totSkip++; else totUpd++;
      } else {
        totSkip++; // claimed/linked — never touch
      }
    }
  }
  if (APPLY) console.log(`\nAPPLIED: inserted ${totIns}, refreshed ${totUpd}, untouched(claimed/linked/err) ${totSkip}`);
  else console.log('\nDRY RUN only — re-run with --apply to write.');
})().catch((e) => { console.error('IMPORT ERROR', e); process.exit(1); });
