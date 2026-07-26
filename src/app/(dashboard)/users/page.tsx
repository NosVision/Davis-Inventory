import { redirect } from 'next/navigation';

// The standalone user-management page merged into the HR people surface (2026-07-27):
// /hr/employees?tab=accounts. This stub keeps every old deep link, notification target,
// and bookmark working. Sub-routes (/users/invitations, /users/[id]/permissions) still
// live here as standalone pages.
export default function UsersRedirectPage() {
  redirect('/hr/employees?tab=accounts');
}
