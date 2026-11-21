/**
 * Per (conversation, sender) state for administrators: the Session they
 * switched to with `/session`. Ordinary users never have a selection — their
 * binding owns the Session. A selection never widens access: every use
 * re-checks the administrator's Workspace scope and the catalog, and `/reset`
 * drops it.
 *
 * The numbered list a `/session 序号` reply would refer to lives in
 * `admin-actions.ts` with the picker card that showed it, not here.
 */
export interface SelectionStore {
  get(chat: string, user: string): string | undefined;
  set(chat: string, user: string, sessionId: string): void;
  clear(chat: string, user: string): void;
  /** Invalidate all switches for a re-assigned chat. */
  clearChat(chat: string): void;
}

export function createSelectionStore(maxEntries = 500): SelectionStore {
  const selected = new Map<string, string>();
  const key = (chat: string, user: string) => `${chat}\0${user}`;
  function put<T>(map: Map<string, T>, k: string, value: T): void {
    map.delete(k);
    map.set(k, value);
    if (map.size > maxEntries) map.delete(map.keys().next().value!);
  }
  return {
    get: (chat, user) => selected.get(key(chat, user)),
    set: (chat, user, sessionId) => put(selected, key(chat, user), sessionId),
    clear: (chat, user) => { selected.delete(key(chat, user)); },
    clearChat(chat) {
      for (const k of selected.keys()) if (k.startsWith(`${chat}\0`)) selected.delete(k);
    },
  };
}
