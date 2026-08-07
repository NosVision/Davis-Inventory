/**
 * Renders a person the same way on every HR screen: ชื่อจริง with the ชื่อเล่น trailing it in a
 * muted tone. See src/lib/hr/employee-name.ts for why the two names exist and which one wins.
 *
 * Accepts either the already-split { name, nickname } an API returns, or the raw columns
 * (full_name / display_name / username) when a page reads a row straight from the DB.
 */

import { resolveEmployeeName, type EmployeeNameSource } from '@/lib/hr/employee-name';

interface EmployeeNameProps {
  /** Pre-split form — what most HR list APIs return. */
  name?: string | null;
  nickname?: string | null;
  /** Raw form — pass a row and let the shared rule split it. Ignored when `name` is given. */
  source?: EmployeeNameSource | null;
  className?: string;
  /** Muted-tone class for the nickname, so a dark row can override it. */
  nicknameClassName?: string;
}

export function EmployeeName({
  name,
  nickname,
  source,
  className,
  nicknameClassName = 'text-gray-400 dark:text-gray-500',
}: EmployeeNameProps) {
  const resolved = name ? { name, nickname: nickname?.trim() || null } : resolveEmployeeName(source);
  // Guard the pre-split path too: an API that sends nickname === name should not print it twice.
  const nick = resolved.nickname && resolved.nickname !== resolved.name ? resolved.nickname : null;

  return (
    <span className={className}>
      {resolved.name}
      {nick && <span className={`ml-1 font-normal ${nicknameClassName}`}>({nick})</span>}
    </span>
  );
}
