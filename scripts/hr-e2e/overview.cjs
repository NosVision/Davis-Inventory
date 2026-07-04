// HR dashboard overview endpoint (redesign) — live-auth e2e. Aggregate feed for today + this
// month: partition invariants (total + per-venue), consistency with /daily, month trend shape,
// pending queue counts, scope enforcement (manager subset + out-of-scope 403), staff lockout.
const { login, req, creds, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);

(async () => {
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const mgr = await login(u('hr-test-manager').email, u('hr-test-manager').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  // ---- HR company-wide -----------------------------------------------------------------
  const r = await req(hr, 'GET', '/api/hr/dashboard/overview');
  check('HR overview 200', r.status === 200, `status=${r.status} ${(r.text || '').slice(0, 120)}`);
  const d = r.json?.data;
  const t = d?.today;
  const m = d?.month_summary;
  check('shape: today + month_summary', !!t && !!m && Array.isArray(t.by_store) && Array.isArray(m.days), d && Object.keys(d));
  check('today partition (in+leave+notin == headcount)',
    (t?.checked_in ?? -1) + (t?.on_leave ?? 0) + (t?.not_in ?? 0) === t?.headcount,
    `in=${t?.checked_in} leave=${t?.on_leave} notin=${t?.not_in} hc=${t?.headcount}`);
  check('late is a number >= 0', typeof t?.late === 'number' && t.late >= 0, t?.late);

  const rowsOk = (t?.by_store ?? []).every(
    (row) => row.checked_in + row.on_leave + row.not_in === row.headcount && row.headcount > 0
  );
  check('every by_store row partitions its headcount', rowsOk, JSON.stringify(t?.by_store ?? []).slice(0, 200));

  // consistency with /daily (same definitions for headcount + checked_in)
  const daily = await req(hr, 'GET', '/api/hr/dashboard/daily');
  const dd = daily.json?.data;
  check('headcount matches /daily', t?.headcount === dd?.headcount, `overview=${t?.headcount} daily=${dd?.headcount}`);
  check('checked_in matches /daily', t?.checked_in === dd?.checked_in?.length, `overview=${t?.checked_in} daily=${dd?.checked_in?.length}`);

  // month trend: one entry per day up to the business date; today's point == today's stat
  const dayOfMonth = Number((d?.business_date ?? '').slice(8, 10));
  check('month days length == day-of-month', (m?.days ?? []).length === dayOfMonth, `days=${m?.days?.length} dom=${dayOfMonth}`);
  const todayPoint = (m?.days ?? []).find((x) => x.date === d?.business_date);
  check("trend's today point == today's checked_in", todayPoint && todayPoint.checked_in === t?.checked_in,
    `point=${JSON.stringify(todayPoint)} today=${t?.checked_in}`);

  // month summary shapes
  check('leave_by_type entries have code+days>0', (m?.leave_by_type ?? []).every((x) => x.code && x.days > 0), JSON.stringify(m?.leave_by_type ?? []).slice(0, 160));
  const p = m?.pending;
  check('pending counts are numbers', p && ['leaves', 'ot', 'attendance', 'claims'].every((k) => typeof p[k] === 'number' && p[k] >= 0), p);
  check('company HR sees profile_changes count', typeof p?.profile_changes === 'number', p?.profile_changes);
  check('counters are numbers', ['new_hires', 'offboarded', 'warnings'].every((k) => typeof m?.[k] === 'number'), m && { h: m.new_hires, o: m.offboarded, w: m.warnings });
  check('payroll is null or a sane snapshot', m?.payroll === null || (m?.payroll?.runs >= 1 && typeof m?.payroll?.net_total_satang === 'number'), m?.payroll);

  // explicit past month date → FULL month trend (a completed month shows all its days, not just
  // up to the picked day-of-month — guards the trendEnd tautology fixed in review R107)
  const past = await req(hr, 'GET', '/api/hr/dashboard/overview?business_date=2026-06-15');
  check('past date 200', past.status === 200, past.status);
  check('past-month trend spans the WHOLE month (June = 30 days), not the picked day', (past.json?.data?.month_summary?.days ?? []).length === 30, past.json?.data?.month_summary?.days?.length);

  // validation
  const bad = await req(hr, 'GET', '/api/hr/dashboard/overview?business_date=15-01-2026');
  check('invalid business_date 400', bad.status === 400, bad.status);

  // ---- scoped manager --------------------------------------------------------------------
  const mv = await req(mgr, 'GET', '/api/hr/dashboard/overview');
  check('manager overview 200', mv.status === 200, mv.status);
  const mt = mv.json?.data?.today;
  check('manager headcount <= company (scoped)', (mt?.headcount ?? Infinity) <= (t?.headcount ?? 0), `mgr=${mt?.headcount} co=${t?.headcount}`);
  check('manager partition holds', (mt?.checked_in ?? -1) + (mt?.on_leave ?? 0) + (mt?.not_in ?? 0) === mt?.headcount,
    `in=${mt?.checked_in} leave=${mt?.on_leave} notin=${mt?.not_in} hc=${mt?.headcount}`);

  const mStores = await req(mgr, 'GET', '/api/hr/manageable-stores');
  const mgrStoreIds = new Set((mStores.json?.data ?? []).map((s) => s.id));
  check('manager by_store ⊆ own scope', (mt?.by_store ?? []).every((row) => mgrStoreIds.has(row.store_id)),
    JSON.stringify({ scope: [...mgrStoreIds], rows: (mt?.by_store ?? []).map((x) => x.store_id) }).slice(0, 200));
  check('manager profile_changes hidden (company-wide function)', mv.json?.data?.month_summary?.pending?.profile_changes === null,
    mv.json?.data?.month_summary?.pending?.profile_changes);

  // out-of-scope ?store_id → 403 (pick a company store the manager does not manage)
  const foreign = (t?.by_store ?? []).map((x) => x.store_id).find((id) => !mgrStoreIds.has(id));
  if (foreign) {
    const f = await req(mgr, 'GET', `/api/hr/dashboard/overview?store_id=${foreign}`);
    check('manager out-of-scope store 403', f.status === 403, f.status);
  } else {
    check('manager out-of-scope store 403 (skipped — no foreign store visible)', true, 'skip');
  }

  // store-filtered HR view stays consistent
  const anyStore = (t?.by_store ?? [])[0];
  if (anyStore) {
    const sf = await req(hr, 'GET', `/api/hr/dashboard/overview?store_id=${anyStore.store_id}`);
    const st = sf.json?.data?.today;
    check('HR store-filtered 200 + single venue row', sf.status === 200 && (st?.by_store ?? []).length === 1 && st.by_store[0].store_id === anyStore.store_id,
      `status=${sf.status} rows=${st?.by_store?.length}`);
    check('store-filtered headcount == that venue row', st?.headcount === anyStore.headcount, `filtered=${st?.headcount} row=${anyStore.headcount}`);
  }

  // ---- staff lockout -----------------------------------------------------------------------
  const s = await req(staff, 'GET', '/api/hr/dashboard/overview');
  check('staff overview FORBIDDEN (401/403)', s.status === 401 || s.status === 403, s.status);

  process.exit(summary('HR_E2E_OVERVIEW') ? 0 : 1);
})().catch((e) => { console.error('OVERVIEW ERROR', e); process.exit(1); });
