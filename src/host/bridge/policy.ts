import type { RejectionReason } from '../../shared/protocol.js';
import type { BridgeSettings } from '../config.js';

/**
 * Access policy. Each list is an independent allowlist; an empty list allows
 * everything in that dimension. A message is accepted only when both its
 * conversation and its sender pass; a Session must pass the Session list.
 */
export interface AccessPolicy {
  readonly chatIds: ReadonlySet<string>;
  readonly userIds: ReadonlySet<string>;
  readonly sessionIds: ReadonlySet<string>;
  chatAllowed(chat: string): boolean;
  userAllowed(user: string): boolean;
  /** Session allowlist only; visibility (archived, subagent) is checked by the directory. */
  sessionListed(sessionId: string): boolean;
  evaluate(chat: string, user: string): { readonly accepted: true } | { readonly accepted: false; readonly reason: RejectionReason };
}

export function createAccessPolicy(settings: Pick<BridgeSettings, 'chatIds' | 'allowedUserIds' | 'sessionIds'>): AccessPolicy {
  const chatIds = new Set(settings.chatIds);
  const userIds = new Set(settings.allowedUserIds);
  const sessionIds = new Set(settings.sessionIds);
  const chatAllowed = (chat: string) => !chatIds.size || chatIds.has(chat);
  const userAllowed = (user: string) => !userIds.size || userIds.has(user);
  return {
    chatIds, userIds, sessionIds,
    chatAllowed,
    userAllowed,
    sessionListed: id => !sessionIds.size || sessionIds.has(id),
    evaluate(chat, user) {
      const chatOk = chatAllowed(chat);
      const userOk = userAllowed(user);
      if (chatOk && userOk) return { accepted: true };
      return { accepted: false, reason: !chatOk && !userOk ? 'user+chat' : !chatOk ? 'chat' : 'user' };
    },
  };
}
