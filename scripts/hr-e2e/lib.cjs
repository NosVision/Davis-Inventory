/**
 * HR live-auth e2e harness. Runs against a RUNNING dev server (default http://localhost:3000)
 * with REAL Supabase auth: it drives @supabase/ssr's own cookie-jar so signInWithPassword writes
 * the exact chunked sb-*-auth-token cookies the Next API routes expect, then replays them on
 * fetch(). This exercises the real auth + RLS layers (which a service-role DB round-trip cannot).
 *
 * Requirements (NOT committed — machine-local):
 *   • dev server up:  npm run dev   (self-startable; Next 16 Turbopack)
 *   • .env.local with NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 *   • test creds JSON at $HR_TEST_CREDS (default F:/tmp/hr-test-creds.json) — passwords, never commit
 *
 * Usage:  node scripts/hr-e2e/run-all.cjs      (or a single suite: node scripts/hr-e2e/p43.cjs)
 */
const path = require('path');
const { pathToFileURL } = require('url');

const repo = path.resolve(__dirname, '..', '..');
require(require.resolve('dotenv', { paths: [repo] })).config({ path: path.join(repo, '.env.local') });

const BASE = process.env.HR_E2E_BASE || 'http://localhost:3000';
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CREDS_PATH = process.env.HR_TEST_CREDS || 'F:/tmp/hr-test-creds.json';

const creds = require(CREDS_PATH);
/** Look up a test user by username (see the creds file for the roster). */
const user = (username) => creds.users.find((x) => x.username === username);

/** Sign in via the SSR cookie-jar; returns { userId, cookieHeader(), jar }. */
async function login(email, password) {
  const ssrEntry = require.resolve('@supabase/ssr', { paths: [repo] });
  const { createServerClient } = await import(pathToFileURL(ssrEntry).href);
  const jar = new Map();
  const supabase = createServerClient(URL, ANON, {
    cookies: {
      getAll() { return [...jar.entries()].map(([name, value]) => ({ name, value })); },
      setAll(list) { for (const { name, value } of list) { if (value) jar.set(name, value); else jar.delete(name); } },
    },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email} failed: ${error.message}`);
  const cookieHeader = () => [...jar.entries()].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join('; ');
  return { userId: data.user.id, cookieHeader, jar };
}

/** Convenience: sign in a test user by username. */
async function loginAs(username) {
  const u = user(username);
  if (!u) throw new Error(`unknown test user: ${username}`);
  return login(u.email, u.password);
}

/** A service-role client for ground-truth reads and deterministic-baseline cleanup (bypasses RLS). */
async function serviceClient() {
  const { createClient } = require(require.resolve('@supabase/supabase-js', { paths: [repo] }));
  return createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

/** fetch with the session cookie + a per-request timeout (never let a hung route stall the suite). */
async function req(session, method, url, body, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + url, {
      method,
      headers: {
        cookie: session.cookieHeader(),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON (csv / redirect / html) */ }
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, json, text, headers };
  } finally {
    clearTimeout(t);
  }
}

// Minimal per-suite assertion counters.
function makeCounter() {
  let pass = 0, fail = 0;
  const check = (label, cond, detail) => {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
  };
  const summary = (name) => {
    console.log(`\n${name} = ${pass}/${pass + fail} ${fail ? 'FAILED' : 'ALL PASS'}`);
    return fail === 0;
  };
  return { check, summary, get pass() { return pass; }, get fail() { return fail; } };
}

module.exports = { BASE, creds, user, login, loginAs, serviceClient, req, makeCounter };
