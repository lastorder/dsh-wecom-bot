import type { WorkspaceOption } from '../../shared/protocol.js';
import type { OperableSession } from './directory.js';
import { verificationCode } from './interactions.js';

/**
 * Pending administrator choices sent as template cards.
 *
 * `/new` and `/session` answer with a numbered text list plus one or more
 * picker cards. WeCom's click callback only carries the card's `task_id` and
 * the button key, so the choices behind a card — the workspaces, the sessions
 * of one workspace — have to be remembered here until the tap arrives.
 *
 * Everything in this module is process memory. A restart (or a bridge rebuild)
 * forgets the choices; a card that outlives them is settled as 「已失效」, just
 * like a question card whose question is gone. Nothing is written to the
 * plugin store: these are decisions in flight, not settings.
 *
 * One *group* is one user action. A list too long for one card is split into
 * several pages, and every page belongs to the same group: whichever page is
 * tapped completes the whole group, and a later tap on a sibling page shows
 * the same outcome (created, switched, cancelled…) rather than acting twice.
 */

/** The shortest a card stays answerable. */
export const ADMIN_CARD_TTL_MS = 5 * 60_000;
/** How long a completed group stays around to answer late taps. */
const TERMINAL_TTL_MS = 15 * 60_000;
/** Most options one picker card carries (a checkbox holds 20; one is spare). */
export const PICKER_PAGE_SIZE = 19;
/** Above this many options a card becomes a single-select checkbox. */
export const PICKER_BUTTON_LIMIT = 5;
/** Most numbered rows one text reply lists; the cards cover exactly these. */
export const PICKER_LIST_LIMIT = 30;
/** Hard cap on remembered groups, so a busy bot cannot grow forever. */
const MAX_GROUPS = 300;

/** How a picker card was settled. */
export type AdminCardOutcome = 'created' | 'switched' | 'selected' | 'creating' | 'cancelled' | 'expired';

export interface AdminWorkspaceGroup {
  readonly id: string;
  readonly chat: string;
  readonly user: string;
  readonly kind: 'workspace';
  readonly purpose: 'new' | 'session';
  readonly workspaces: readonly WorkspaceOption[];
  /** The Workspace to mark in the list: the last one created in, or the current Session's. */
  readonly currentPath: string;
  /** The Session the administrator is on, to mark its row after a Workspace pick. */
  readonly currentSessionId?: string;
  readonly pageNonces: readonly string[];
  readonly createdAt: number;
  readonly expiresAt: number;
  processing: boolean;
  outcome?: AdminCardOutcome;
  summary?: string;
  doneAt?: number;
}

export interface AdminSessionGroup {
  readonly id: string;
  readonly chat: string;
  readonly user: string;
  readonly kind: 'session';
  readonly purpose: 'session';
  readonly sessions: readonly OperableSession[];
  readonly workspaceTitle: string;
  readonly currentSessionId?: string;
  readonly pageNonces: readonly string[];
  readonly createdAt: number;
  readonly expiresAt: number;
  processing: boolean;
  outcome?: AdminCardOutcome;
  summary?: string;
  doneAt?: number;
}

export type AdminGroup = AdminWorkspaceGroup | AdminSessionGroup;

/** One card of a group: a nonce (its `task_id`) and where its slice starts. */
export interface AdminPage {
  readonly nonce: string;
  readonly groupId: string;
  /** 0-based index of the group's first option on this page. */
  readonly offset: number;
}

export interface AdminActionRegistry {
  openWorkspace(input: {
    readonly chat: string;
    readonly user: string;
    readonly purpose: 'new' | 'session';
    readonly workspaces: readonly WorkspaceOption[];
    readonly currentPath: string;
    readonly currentSessionId?: string;
  }): { readonly group: AdminWorkspaceGroup; readonly pages: readonly AdminPage[] };
  openSession(input: {
    readonly chat: string;
    readonly user: string;
    readonly sessions: readonly OperableSession[];
    readonly workspaceTitle: string;
    readonly currentSessionId?: string;
  }): { readonly group: AdminSessionGroup; readonly pages: readonly AdminPage[] };
  /** The page and group behind a card tap; undefined once expired. */
  find(nonce: string): { readonly group: AdminGroup; readonly page: AdminPage } | undefined;
  /** The one active group of this private chat, for a typed `/new 序号` / `/session 序号`. */
  byChat(chat: string, user: string): AdminGroup | undefined;
  /** Claim a group for the pick in flight; false for a second tap. */
  begin(nonce: string): boolean;
  /** Give the group back after a recoverable refusal (nothing was done). */
  release(nonce: string): void;
  /** Close every page of the group and remember how it ended. */
  complete(groupId: string, outcome: AdminCardOutcome, summary?: string): void;
  /** How a card outlived its group ended, for a late tap; undefined when unknown. */
  outcome(nonce: string): { readonly group: AdminGroup; readonly outcome: AdminCardOutcome; readonly summary?: string } | undefined;
  /** Drop a chat's pending choices (a routing edit or a new command). */
  clearChat(chat: string): void;
  cancelAll(): void;
}

export interface AdminActionRegistryOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly terminalTtlMs?: number;
}

/**
 * Page slices of one list, in card-sized pieces. Up to five items stay a row of
 * buttons; above that every page is a checkbox list, nineteen at a time.
 */
export function pickerPages(total: number): { readonly offset: number; readonly size: number }[] {
  if (total <= 0) return [];
  if (total <= PICKER_BUTTON_LIMIT) return [{ offset: 0, size: total }];
  const pages: { offset: number; size: number }[] = [];
  for (let offset = 0; offset < total; offset += PICKER_PAGE_SIZE) {
    pages.push({ offset, size: Math.min(PICKER_PAGE_SIZE, total - offset) });
  }
  return pages;
}

export function createAdminActionRegistry(options: AdminActionRegistryOptions = {}): AdminActionRegistry {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? ADMIN_CARD_TTL_MS;
  const terminalTtlMs = options.terminalTtlMs ?? TERMINAL_TTL_MS;
  /** Every group, active or completed (until its terminal copy expires). */
  const groups = new Map<string, AdminGroup>();
  /** Active pages, keyed by the card's nonce. */
  const pages = new Map<string, AdminPage>();
  /** Every nonce that ever belonged to a group, so a late tap can name its outcome. */
  const nonceGroup = new Map<string, string>();

  function freshNonce(): string {
    let nonce: string;
    do { nonce = verificationCode(); } while (nonceGroup.has(nonce));
    return nonce;
  }

  function forget(group: AdminGroup): void {
    for (const nonce of group.pageNonces) {
      pages.delete(nonce);
      nonceGroup.delete(nonce);
    }
    groups.delete(group.id);
  }

  function close(group: AdminGroup, outcome: AdminCardOutcome, summary?: string): void {
    group.outcome = outcome;
    if (summary !== undefined) group.summary = summary;
    group.processing = false;
    group.doneAt ??= now();
    for (const nonce of group.pageNonces) pages.delete(nonce);
  }

  function prune(): void {
    const time = now();
    for (const group of [...groups.values()]) {
      if (!group.outcome && time >= group.expiresAt) close(group, 'expired');
      const endedAt = group.doneAt ?? group.expiresAt;
      if (group.outcome && time > endedAt + terminalTtlMs) forget(group);
    }
    // A deployment that never stops creating sessions must not grow without
    // bound: the oldest completed group is the first thing to go.
    if (groups.size > MAX_GROUPS) {
      for (const group of groups.values()) {
        if (!group.outcome) continue;
        forget(group);
        if (groups.size <= MAX_GROUPS) break;
      }
    }
  }

  /** Any older pending group of this chat is replaced by the new one. */
  function cancelPending(chat: string, user: string): void {
    for (const group of [...groups.values()]) {
      if (!group.outcome && group.chat === chat && group.user === user) close(group, 'cancelled');
    }
  }

  function remember(group: AdminGroup, opened: readonly AdminPage[]): void {
    groups.set(group.id, group);
    for (const page of opened) {
      pages.set(page.nonce, page);
      nonceGroup.set(page.nonce, group.id);
    }
  }

  function findPage(nonce: string): { group: AdminGroup; page: AdminPage } | undefined {
    prune();
    const page = pages.get(nonce);
    if (!page) return undefined;
    const group = groups.get(page.groupId);
    if (!group || group.outcome) return undefined;
    return { group, page };
  }

  return {
    openWorkspace({ chat, user, purpose, workspaces, currentPath, currentSessionId }) {
      prune();
      cancelPending(chat, user);
      const id = `g${verificationCode(10)}`;
      const slices = pickerPages(workspaces.length);
      const pageNonces = slices.map(() => freshNonce());
      const time = now();
      const group: AdminWorkspaceGroup = {
        id, chat, user, kind: 'workspace', purpose, workspaces, currentPath,
        pageNonces, createdAt: time, expiresAt: time + ttlMs, processing: false,
        ...(currentSessionId ? { currentSessionId } : {}),
      };
      const opened = slices.map((slice, index) => ({ nonce: pageNonces[index]!, groupId: id, offset: slice.offset }));
      remember(group, opened);
      return { group, pages: opened };
    },
    openSession({ chat, user, sessions, workspaceTitle, currentSessionId }) {
      prune();
      cancelPending(chat, user);
      const id = `g${verificationCode(10)}`;
      const slices = pickerPages(sessions.length);
      const pageNonces = slices.map(() => freshNonce());
      const time = now();
      const group: AdminSessionGroup = {
        id, chat, user, kind: 'session', purpose: 'session', sessions, workspaceTitle,
        pageNonces, createdAt: time, expiresAt: time + ttlMs, processing: false,
        ...(currentSessionId ? { currentSessionId } : {}),
      };
      const opened = slices.map((slice, index) => ({ nonce: pageNonces[index]!, groupId: id, offset: slice.offset }));
      remember(group, opened);
      return { group, pages: opened };
    },
    find: findPage,
    byChat(chat, user) {
      prune();
      for (const group of groups.values()) {
        if (!group.outcome && group.chat === chat && group.user === user) return group;
      }
      return undefined;
    },
    begin(nonce) {
      const found = findPage(nonce);
      if (!found || found.group.processing) return false;
      found.group.processing = true;
      return true;
    },
    release(nonce) {
      prune();
      const page = pages.get(nonce);
      const group = page ? groups.get(page.groupId) : undefined;
      if (group && !group.outcome) group.processing = false;
    },
    complete(groupId, outcome, summary) {
      prune();
      const group = groups.get(groupId);
      if (group) close(group, outcome, summary);
    },
    outcome(nonce) {
      prune();
      const groupId = nonceGroup.get(nonce);
      if (!groupId) return undefined;
      const group = groups.get(groupId);
      if (!group?.outcome) return undefined;
      return { group, outcome: group.outcome, ...(group.summary !== undefined ? { summary: group.summary } : {}) };
    },
    clearChat(chat) {
      prune();
      for (const group of [...groups.values()]) {
        if (!group.outcome && group.chat === chat) close(group, 'cancelled');
      }
    },
    cancelAll() {
      for (const group of groups.values()) if (!group.outcome) close(group, 'cancelled');
    },
  };
}
