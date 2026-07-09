import { createServiceClient } from '@/lib/supabase/server';
import { notifyUser } from '@/lib/notifications/service';

// Shared SOP-warning issuer (owner ask 2026-07-09). See docs/hr/stock-penalty-to-hr.md.
// When a store crosses the monthly SOP threshold this: (1) ALWAYS notifies the store's HQ +
// owner so it never goes unseen, and (2) when `issueWarning` is true, issues a single verbal
// warning to the store's head_bar. Deduped per store/month via hr_warnings.detail='stock_sop_monthly'.
//
// Extracted from the penalties POST route so the HQ management surface (Auto/Manual toggle +
// manual "send warning" button) can reuse the exact same behaviour. The `issueWarning` flag
// decouples "should the head_bar warning fire" from how the caller decides it (Auto mode vs an
// explicit HQ click) — the notify-HQ/owner side always runs regardless.

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface IssueSopWarningArgs {
  storeId: string;
  monthYear: string;
  sopPoints: number;
  issuedBy: string;
  /** true → also issue the head_bar warning; false → only notify HQ/owner (manual mode) */
  issueWarning: boolean;
}

export async function issueSopWarning(
  service: ServiceClient,
  args: IssueSopWarningArgs
): Promise<{ issued: boolean; reason?: string }> {
  const { storeId, monthYear, sopPoints, issuedBy, issueWarning } = args;

  // Already alerted for this store/month? (dedupe on the warning marker.)
  const { data: existing } = await service
    .from('hr_warnings')
    .select('id, issued_at')
    .eq('store_id', storeId)
    .eq('detail', 'stock_sop_monthly')
    .gte('issued_at', `${monthYear}-01`)
    .limit(1);
  if ((existing ?? []).length > 0) return { issued: false, reason: 'already_alerted' };

  // Find this store's head_bar (the accountable lead).
  const { data: members } = await service
    .from('user_stores')
    .select('user_id, profiles!inner(id, role)')
    .eq('store_id', storeId);
  type Row = { profiles: { id: string; role: string } | { id: string; role: string }[] | null };
  const headBar = ((members ?? []) as unknown as Row[])
    .flatMap((r) => (Array.isArray(r.profiles) ? r.profiles : r.profiles ? [r.profiles] : []))
    .find((p) => p.role === 'head_bar');

  const reason = `แต้มความผิดสต๊อกของร้านครบ ${sopPoints} ครั้งในเดือน ${monthYear} — เกินเกณฑ์เตือน`;

  // Always notify HQ + owner of the store so it never goes unseen (works for Auto and Manual).
  const { data: mgmt } = await service
    .from('user_stores')
    .select('user_id, profiles!inner(id, role)')
    .eq('store_id', storeId);
  const notifyRoles = new Set(['hq', 'owner']);
  const recipients = ((mgmt ?? []) as unknown as Row[])
    .flatMap((r) => (Array.isArray(r.profiles) ? r.profiles : r.profiles ? [r.profiles] : []))
    .filter((p) => notifyRoles.has(p.role))
    .map((p) => p.id);
  await Promise.all(
    [...new Set(recipients)].map((uid) =>
      notifyUser({
        userId: uid,
        storeId,
        type: 'stock_alert',
        title: '⚠️ แต้มความผิดสต๊อกเกินเกณฑ์',
        body: reason,
        data: { url: '/stock/owner-review' },
      }).catch(() => {})
    )
  );

  if (!issueWarning) return { issued: false, reason: 'manual_mode' };
  if (!headBar) return { issued: false, reason: 'no_head_bar' };

  // Issue a verbal warning to the head_bar (money already comes from the fines).
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);
  const { error: wErr } = await service.from('hr_warnings').insert({
    user_id: headBar.id,
    issued_by: issuedBy,
    store_id: storeId,
    level: 'verbal',
    sc_deduct_cycles: 0,
    reason,
    detail: 'stock_sop_monthly',
    status: 'active',
    expires_at: expires.toISOString(),
  });
  if (wErr) return { issued: false, reason: wErr.message };

  await notifyUser({
    userId: headBar.id,
    storeId,
    type: 'hr_warning_issued',
    title: '📄 คุณได้รับใบเตือน',
    body: reason,
    data: { url: '/me/warnings' },
  }).catch(() => {});

  return { issued: true };
}
