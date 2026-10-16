/**
 * Wire contract shared by the Host plugin and the browser settings page.
 *
 * This module holds only constants and types, so both halves can import it:
 * the Host through NodeNext (`../shared/protocol.js`) and the browser bundle
 * through esbuild (`../shared/protocol.ts`).
 */

export const PACKAGE_NAME = 'dsh-wecom-bot';
/** Loader entry id from cordis.patch.yml; also the Config form namespace. */
export const CONFIG_NAMESPACE = 'wecom-bot';
export const DEFAULT_SECRET_REF = 'WECOM_BOT_SECRET';
/** Authenticated Connection Fetch route; the browser reads it document-relative. */
export const STATE_ROUTE = '/api/wecom-bot/state';
/** Directory below the DSH home that holds this plugin's own data. */
export const PLUGIN_HOME_DIRECTORY = 'wecom-bot';

export type ConnectionPhase =
  | 'unconfigured' // Bot ID or Secret missing
  | 'invalid' // configuration rejected before connecting
  | 'connecting'
  | 'online' // authenticated; proactive messages can be sent
  | 'reconnecting'
  | 'offline'
  | 'displaced' // another connection took over this Bot
  | 'error';

export interface ConnectionStatus {
  readonly phase: ConnectionPhase;
  /** Epoch ms of the last phase change. */
  readonly since: number;
  /** Short, already-redacted explanation. */
  readonly detail?: string;
}

export interface TrafficStats {
  /** Epoch ms when these counters started (Host start). */
  readonly since: number;
  readonly received: number;
  readonly rejected: number;
  readonly prompts: number;
  readonly notifications: number;
  readonly failures: number;
  readonly lastMessageAt?: number;
}

export type AccessDecision = 'accepted' | 'rejected';
export type RejectionReason = 'user' | 'chat' | 'user+chat';

/** One WeCom user or conversation that actually sent the Bot a message. */
export interface ObservedIdentity {
  readonly id: string;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly messages: number;
  /** Access decision of the latest message, under the configuration of that moment. */
  readonly decision: AccessDecision;
  readonly reason?: RejectionReason;
  /** Conversations only: single chats use the sender's userid as their ID. */
  readonly chatType?: 'single' | 'group';
  /** Users: the latest conversation; group conversations: the latest sender. */
  readonly via?: string;
}

export interface ObservedIdentities {
  /** Newest first. */
  readonly users: readonly ObservedIdentity[];
  /** Newest first. */
  readonly chats: readonly ObservedIdentity[];
}

export interface CatalogSession {
  readonly sessionId: string;
  /** Stored DSH title; null for an unnamed Session. */
  readonly title: string | null;
  readonly running: boolean;
  readonly pinned: boolean;
  readonly updatedAt: number;
}

export interface CatalogGroup {
  /** Workspace id, `dir:<path>`, or `ungrouped`. */
  readonly key: string;
  readonly kind: 'workspace' | 'directory' | 'ungrouped';
  readonly title: string;
  readonly path?: string;
  readonly sessions: readonly CatalogSession[];
}

/** A configured Session id that the catalog no longer shows. */
export interface HiddenSelection {
  readonly sessionId: string;
  readonly title: string | null;
  /** `blank`: never prompted; DSH may reuse such a Session for "New Session". */
  readonly reason: 'archived' | 'subagent' | 'blank' | 'missing';
}

export interface SessionCatalogView {
  readonly groups: readonly CatalogGroup[];
  readonly total: number;
  /** Number of archived Sessions omitted from groups. */
  readonly archived: number;
  readonly generatedAt: number;
  readonly hiddenSelections: readonly HiddenSelection[];
}

export interface JournalInfo {
  readonly enabled: boolean;
  /** Absolute directory of the JSONL files. */
  readonly directory: string;
  /** Absolute path of today's file. */
  readonly file: string;
  readonly retentionDays: number;
}

export interface BridgeStateView {
  readonly version: 1;
  readonly connection: ConnectionStatus;
  readonly traffic: TrafficStats;
  readonly observed: ObservedIdentities;
  readonly sessions: SessionCatalogView | null;
  readonly sessionsError?: string;
  readonly journal: JournalInfo;
}
