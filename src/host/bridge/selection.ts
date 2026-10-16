/**
 * Per (conversation, sender) state: the selected Session and the numbered
 * listing from the latest `/sessions`, so `/use 3` refers to what that
 * person just saw. A selection never widens access: every use re-checks
 * the current policy and catalog.
 */
export interface SelectionStore {
  get(chat: string, user: string): string | undefined;
  set(chat: string, user: string, sessionId: string): void;
  listing(chat: string, user: string): readonly string[] | undefined;
  setListing(chat: string, user: string, sessionIds: readonly string[]): void;
}

export function createSelectionStore(maxEntries = 500): SelectionStore {
  const selected = new Map<string, string>();
  const listings = new Map<string, readonly string[]>();
  const key = (chat: string, user: string) => `${chat}\0${user}`;
  function put<T>(map: Map<string, T>, k: string, value: T): void {
    map.delete(k);
    map.set(k, value);
    if (map.size > maxEntries) map.delete(map.keys().next().value!);
  }
  return {
    get: (chat, user) => selected.get(key(chat, user)),
    set: (chat, user, sessionId) => put(selected, key(chat, user), sessionId),
    listing: (chat, user) => listings.get(key(chat, user)),
    setListing: (chat, user, ids) => put(listings, key(chat, user), [...ids]),
  };
}
