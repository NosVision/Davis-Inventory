// UI-only fixture test: every API and Supabase request is intercepted; no real deposits are created.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DEPOSIT_TEST_URL || 'http://localhost:3107';
const out = process.env.DEPOSIT_TEST_OUTPUT || 'storage-backup/deposit-ui';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const locale of ['th', 'en']) {
      const messages = require(`../src/messages/${locale}.json`).customer;
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addInitScript(lang => localStorage.setItem('customer-lang', lang), locale);
      const page = await context.newPage();
      let fixture = [];
      const submissions = [];
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname.endsWith('supabase.co')) return route.fulfill({ json: [{ store_id:'fixture-store', withdrawal_blocked_days:['Fri','Sat'] }] });
        if (url.origin !== base) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (url.pathname === '/api/auth/customer-token') return route.fulfill({ json: { lineUserId:'fixture-line', displayName:'Test customer' } });
        if (url.pathname === '/api/public/store-lookup') return route.fulfill({ json: { id:'fixture-store', name:'Test store' } });
        if (url.pathname === '/api/customer/deposits') return route.fulfill({ json: { deposits:fixture } });
        if (url.pathname === '/api/customer/deposit-request') {
          submissions.push(route.request().postDataJSON());
          return route.fulfill({ json: { success:true } });
        }
        return route.fulfill({ json:{} });
      });
      await page.goto(`${base}/customer?token=fixture&store=TEST`, { waitUntil:'networkidle', timeout:120000 });
      await page.getByRole('tab', { name:messages.nav.deposit, exact:true }).click();
      const checkbox = page.getByRole('checkbox');
      assert.equal(await checkbox.isChecked(), false);
      assert.equal(await page.locator('fieldset li').count(), 6);
      await page.getByPlaceholder(messages.deposit.customerNamePlaceholder, { exact:true }).fill('Test customer');
      await page.getByPlaceholder(messages.deposit.phonePlaceholder, { exact:true }).fill('0800000000');
      const submit = page.getByRole('button', { name:messages.deposit.submit, exact:true });
      assert.equal(await submit.isDisabled(), true);
      await checkbox.check();
      assert.equal(await submit.isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path:`${out}/terms-${locale}.png`, fullPage:true });
      await submit.click();
      await page.getByText(messages.deposit.successTitle, { exact:true }).waitFor();
      assert.equal(submissions.length, 1);
      assert.equal(submissions[0].termsAccepted, true);
      assert.equal(submissions[0].termsLocale, locale);
      assert.equal(submissions[0].termsVersion, '2026-09-10');
      await page.getByRole('button', { name:messages.deposit.submit, exact:true }).click();
      assert.equal(await checkbox.isChecked(), false);

      fixture = [{ id:'fixture-deposit', deposit_code:'DEP-TEST', product_name:'Test bottle',
        remaining_percent:50, remaining_qty:1, expiry_date:'2026-09-30T23:59:59+07:00',
        collection_deadline_at:'2026-10-01T04:00:00+07:00', status:'in_store',
        store_id:'fixture-store', store:{store_name:'Test store'}, created_at:'2026-09-01', bottles:[] }];
      await page.clock.setFixedTime(new Date('2026-10-01T03:59:59+07:00'));
      await page.getByRole('tab', { name:messages.nav.myDeposits, exact:true }).click();
      const withdraw = page.getByRole('button', { name:messages.home.requestWithdrawal, exact:true });
      await withdraw.waitFor();
      assert.equal(await withdraw.isEnabled(), true);
      assert.match(await page.locator('.customer-card').innerText(), /04:00/);
      await withdraw.click();
      const confirm = page.getByRole('button', { name:messages.home.confirm, exact:true });
      await confirm.waitFor();
      await page.clock.setFixedTime(new Date('2026-10-01T04:00:00+07:00'));
      await page.waitForFunction(text => Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === text && b.disabled), messages.home.confirm);
      assert.equal(await confirm.isDisabled(), true);
      await page.screenshot({ path:`${out}/expired-${locale}.png`, fullPage:true });
      await context.close();
      console.log(`PASS ${locale}: consent gate, evidence payload, reset, mobile width, exact 04:00 cutoff with modal open`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
