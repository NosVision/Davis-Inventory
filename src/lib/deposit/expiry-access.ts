export function canManageDepositExpiry(role: string | null | undefined): boolean {
  return role === 'bar';
}
