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
/** Authenticated Connection Fetch route that applies binding edits. */
export const BINDINGS_ROUTE = '/api/wecom-bot/bindings';
/** Directory below the DSH home that holds this plugin's own data. */
export const PLUGIN_HOME_DIRECTORY = 'wecom-bot';
/** The plugin's own Workspace directory, below {@link PLUGIN_HOME_DIRECTORY}. */
export const PLUGIN_WORKSPACE_DIRECTORY = 'workspace';
/** Sidebar title of the plugin's own Workspace. */
export const PLUGIN_WORKSPACE_TITLE = '企业微信';
/** Persisted binding-file version. */
export const BINDINGS_VERSION = 1;
/** Upper bound on persisted chat bindings. */
export const MAX_BINDINGS = 500;

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

export interface ModelSelection {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

export interface CatalogSession {
  readonly sessionId: string;
  /** Stored DSH title; null for an unnamed Session. */
  readonly title: string | null;
  readonly running: boolean;
  readonly pinned: boolean;
  readonly updatedAt: number;
  /** Model of the Session's latest request, when DSH reports one. */
  readonly model?: ModelSelection;
}

export interface CatalogGroup {
  /** Workspace id, `dir:<path>`, or `ungrouped`. */
  readonly key: string;
  readonly kind: 'workspace' | 'directory' | 'ungrouped';
  readonly title: string;
  readonly path?: string;
  readonly sessions: readonly CatalogSession[];
}

/** A Session id that the catalog does not show as an operable Session. */
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

/* ------------------------------------------------------------------ *
 * Routing: one binding per WeCom private chat (its sender) or group   *
 * ------------------------------------------------------------------ */

export type BindingKind = 'user' | 'group';

/** A routing binding: one WeCom conversation → one Workspace/Session/model. */
export interface BindingRecord {
  readonly kind: BindingKind;
  /** userid for a private chat, chatid for a group. */
  readonly id: string;
  /** Workspace path; empty means the plugin's default Workspace. */
  readonly workspace: string;
  /** Bound Session id; empty means "create one on the next message". */
  readonly sessionId: string;
  /** Model override; empty means the plugin default, then the DSH default. */
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort: string;
  /** Free-form operator note. */
  readonly note?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Why a bound Session cannot be used as-is. */
export type BindingSessionState = 'bound' | 'auto' | 'blank' | 'missing' | 'archived' | 'unusable';

/** One binding as shown on the settings page. */
export interface BindingView {
  /** `user:<userid>` or `group:<chatid>`. */
  readonly key: string;
  readonly kind: BindingKind;
  readonly id: string;
  readonly note?: string;
  /** The sender is in the plugin's administrator list. */
  readonly admin: boolean;
  /** Configured Workspace path; empty means the plugin default. */
  readonly workspace: string;
  readonly workspaceTitle: string;
  /** Effective absolute Workspace path; empty when unresolved. */
  readonly workspacePath: string;
  readonly workspaceError?: string;
  /** Configured Session id; empty means "create on the next message". */
  readonly sessionId: string;
  readonly sessionTitle: string | null;
  readonly sessionState: BindingSessionState;
  readonly sessionRunning: boolean;
  /** Configured model override; empty means the plugin default. */
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
  /** Model a prompt would use after the next message is routed here. */
  readonly effectiveProvider: string;
  readonly effectiveModel: string;
  readonly effectiveReasoningEffort?: string;
  /** Model of the Session's latest request, when DSH reports one. */
  readonly sessionModel?: ModelSelection;
  readonly messages: number;
  readonly lastSeenAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface BindingsView {
  readonly items: readonly BindingView[];
  readonly total: number;
  /** True when the store is at {@link MAX_BINDINGS} and refused new bindings. */
  readonly full: boolean;
}

/** One selectable provider/model pair from DSH's model catalog. */
export interface ModelChoice {
  readonly provider: string;
  readonly providerName: string;
  readonly model: string;
  readonly name: string;
  /** Reasoning efforts this model accepts, when it accepts any. */
  readonly efforts?: readonly { readonly id: string; readonly name: string }[];
  readonly defaultEffort?: string;
}

export interface ModelCatalogView {
  readonly choices: readonly ModelChoice[];
  /** Model a Session uses when neither the binding nor the plugin picks one. */
  readonly dshDefault: ModelSelection | null;
  readonly failures: readonly { readonly id: string; readonly name: string; readonly message: string }[];
  readonly fetchedAt: number;
}

export interface WorkspaceOption {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  /** The plugin's own Workspace under the DSH home. */
  readonly pluginOwned: boolean;
  readonly sessionCount: number;
}

/** Defaults the plugin applies to bindings that configure nothing. */
export interface PluginDefaultsView {
  /** Configured Workspace path; empty means the plugin's own Workspace. */
  readonly workspace: string;
  readonly workspacePath: string;
  readonly workspaceTitle: string;
  readonly workspaceError?: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

/** Edits the settings page applies to one binding. */
export type BindingOp =
  | {
    readonly op: 'set';
    readonly key: string;
    readonly patch: {
      readonly workspace?: string;
      readonly sessionId?: string;
      readonly provider?: string;
      readonly model?: string;
      readonly reasoningEffort?: string;
      readonly note?: string;
    };
  }
  | { readonly op: 'create'; readonly kind: BindingKind; readonly id: string }
  | { readonly op: 'delete'; readonly key: string };

export interface BindingsRequest {
  readonly ops: readonly BindingOp[];
}

export interface BindingsResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly bindings?: BindingsView;
}

export interface BridgeStateView {
  readonly version: 2;
  readonly connection: ConnectionStatus;
  readonly traffic: TrafficStats;
  readonly observed: ObservedIdentities;
  readonly sessions: SessionCatalogView | null;
  readonly sessionsError?: string;
  readonly bindings: BindingsView | null;
  readonly bindingsError?: string;
  readonly models: ModelCatalogView | null;
  readonly modelsError?: string;
  readonly workspaces: readonly WorkspaceOption[];
  readonly defaults: PluginDefaultsView;
  readonly admins: readonly string[];
  readonly adminWorkspaces: readonly string[];
  /** Non-fatal setup problems worth showing on the page. */
  readonly notices: readonly string[];
  readonly journal: JournalInfo;
}
