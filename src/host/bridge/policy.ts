import type { RejectionReason } from '../../shared/protocol.js';
import { pathListed, type BridgeSettings } from '../config.js';

/**
 * Access policy. Two independent allowlists gate who may talk to the Bot at
 * all; an empty list allows everything in that dimension. Routing is not
 * decided here: which Session a conversation reaches comes from its binding,
 * and only administrators may leave their own binding.
 */
export interface AccessPolicy {
  readonly chatIds: ReadonlySet<string>;
  readonly userIds: ReadonlySet<string>;
  readonly adminUserIds: ReadonlySet<string>;
  readonly adminWorkspaces: readonly string[];
  chatAllowed(chat: string): boolean;
  userAllowed(user: string): boolean;
  /** Administrators may switch Sessions and receive Workspace-scoped notices. */
  isAdmin(user: string): boolean;
  /** Whether an administrator scope covers one Workspace directory. */
  adminWorkspaceAllowed(path: string | undefined): boolean;
  evaluate(chat: string, user: string): { readonly accepted: true } | { readonly accepted: false; readonly reason: RejectionReason };
}

export function createAccessPolicy(
  settings: Pick<BridgeSettings, 'chatIds' | 'allowedUserIds' | 'adminUserIds' | 'adminWorkspaces'>,
): AccessPolicy {
  const chatIds = new Set(settings.chatIds);
  const userIds = new Set(settings.allowedUserIds);
  const adminUserIds = new Set(settings.adminUserIds);
  const adminWorkspaces = settings.adminWorkspaces;
  const chatAllowed = (chat: string) => !chatIds.size || chatIds.has(chat);
  const userAllowed = (user: string) => !userIds.size || userIds.has(user);
  return {
    chatIds, userIds, adminUserIds, adminWorkspaces,
    chatAllowed,
    userAllowed,
    isAdmin: user => adminUserIds.has(user),
    adminWorkspaceAllowed: (path: string | undefined) => pathListed(adminWorkspaces, path),
    evaluate(chat, user) {
      const chatOk = chatAllowed(chat);
      const userOk = userAllowed(user);
      if (chatOk && userOk) return { accepted: true };
      return { accepted: false, reason: !chatOk && !userOk ? 'user+chat' : !chatOk ? 'chat' : 'user' };
    },
  };
}
