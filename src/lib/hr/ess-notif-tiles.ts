// Single source of truth mapping HR employee-facing notification types → the /me tile they badge,
// plus the reverse (tile → its notification types). Used by BOTH the badge-count API
// (/api/hr/ess/badges) and the in-page notice banner (<TileNotices/>), so a badged tile can
// actually SHOW what it is alerting about — and clear the badge once seen (owner ask 2026-07-08).
export const NOTIF_TILE: Record<string, string> = {
  hr_leave_result: 'leaves',
  hr_attendance_result: 'checkin',
  hr_attendance_reminder: 'checkin',
  hr_payslip_ready: 'payslips',
  hr_paper_ready: 'payslips',
  hr_doc_ready: 'documents',
  hr_swap_result: 'swaps',
  hr_identity_result: 'profile',
};

// Reverse index: tile key → the notification types that badge it. Derived so the two never drift.
export const TILE_TYPES: Record<string, string[]> = Object.entries(NOTIF_TILE).reduce(
  (acc, [type, tile]) => {
    (acc[tile] ??= []).push(type);
    return acc;
  },
  {} as Record<string, string[]>
);
