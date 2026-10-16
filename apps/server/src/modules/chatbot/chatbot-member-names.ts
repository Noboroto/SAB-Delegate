/** How long the one batched member lookup may take before names fall back to usernames. */
const MEMBER_FETCH_TIMEOUT_MS = 5_000;

type NamedMember = { id: string; displayName: string };

/** What the lookup needs of `guild.members`; the real manager is assignable to it. */
type MemberDirectory = {
  cache: { get(id: string): { displayName: string } | undefined };
  fetch(options: { user: string[]; time: number }): Promise<{ values(): Iterable<NamedMember> }>;
};

/**
 * Server display names by member id: the cached member, else one batched
 * lookup for everyone still unknown, so a page of N members costs one request
 * and never a whole-server fetch. A failed lookup leaves those ids out of the
 * result and is handed to `onFailure`; `timeoutMs` bounds the one request; the caller decides what a missing name
 * shows as.
 */
export async function lookupDisplayNames(
  members: MemberDirectory,
  ids: Iterable<string>,
  onFailure: (error: unknown) => void,
  timeoutMs: number = MEMBER_FETCH_TIMEOUT_MS,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const missing = new Set<string>();
  for (const id of ids) {
    const known = members.cache.get(id)?.displayName;
    if (known === undefined) missing.add(id);
    else names.set(id, known);
  }
  if (missing.size === 0) return names;
  try {
    const found = await members.fetch({ user: [...missing], time: timeoutMs });
    for (const member of found.values()) names.set(member.id, member.displayName);
  } catch (error) {
    onFailure(error);
  }
  return names;
}
