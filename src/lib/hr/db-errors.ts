// Shared Postgres error detection helpers for HR routes.

export function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' || (error.message ?? '').toLowerCase().includes('duplicate');
}

export function isForeignKeyViolation(error: { code?: string; message?: string }): boolean {
  return error.code === '23503' || (error.message ?? '').toLowerCase().includes('foreign key');
}
