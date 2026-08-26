/**
 * How the set of company-document issuers reads on screen.
 *
 * Kept dependency-free (and separate from document-issuers.ts, which queries) so the phrasing can
 * be asserted without a database — see scripts/hr-misc-assert.cjs. The wrong version of this list
 * shipped once: it was guessed from role in the client and named someone who could not issue
 * anything, which is exactly the kind of mistake a pure function is cheap to pin down.
 */

export interface DocumentIssuer {
  user_id: string;
  name: string;
  nickname: string | null;
  /** Owners hold the right through their role — listed, but not removable. */
  implicit: boolean;
}

/**
 * "May และเจ้าของระบบ" — the issuers as one readable phrase.
 *
 * Owners collapse into a single word rather than being listed by name: the owner accounts include
 * a break-glass login whose username on a shared screen is noise at best.
 */
export function describeIssuers(issuers: readonly DocumentIssuer[], isTh = true): string {
  const named = issuers
    .filter((i) => !i.implicit)
    .map((i) => (i.nickname ? `${i.name} (${i.nickname})` : i.name));
  const hasOwner = issuers.some((i) => i.implicit);
  const ownerWord = isTh ? 'เจ้าของระบบ' : 'the system owners';

  if (named.length === 0) {
    if (hasOwner) return ownerWord;
    return isTh ? 'ยังไม่มีใคร' : 'nobody yet';
  }
  const list = named.join(', ');
  if (!hasOwner) return list;
  return isTh ? `${list} และ${ownerWord}` : `${list} and ${ownerWord}`;
}
