import { redirect } from 'next/navigation';

// Invitation-link management merged into the ลิงก์รับพนักงาน tab of the HR people surface
// (2026-07-27). This stub keeps old deep links and guide references working.
export default function InvitationsRedirectPage() {
  redirect('/hr/employees?tab=links');
}
