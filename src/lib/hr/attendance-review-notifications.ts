/**
 * Notifications in the store are newest-first. Keeping only this id as the effect dependency
 * means other HR notifications do not refetch the hub badges.
 */
export function latestHrAttendanceReviewNotificationId(
  notifications: Array<{ id: string; type: string | null }>
): string | null {
  return notifications.find((notification) => notification.type === 'hr_attendance_review')?.id ?? null;
}
