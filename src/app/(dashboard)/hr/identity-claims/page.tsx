import { redirect } from 'next/navigation';

// The identity-claims review queue merged into the accounts tab of the HR people surface
// (owner ask 2026-07-27): the "คำขอยืนยันตัวตน" summary card on /hr/employees. This stub keeps
// old deep links, hub-badge chips, and bookmarks working.
export default function IdentityClaimsRedirectPage() {
  redirect('/hr/employees?tab=accounts&view=claims');
}
