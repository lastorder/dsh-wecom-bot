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
/** Authenticated Connection Fetch route that applies group/member edits. */
export const ROUTING_ROUTE = '/api/wecom-bot/routing';
/** Directory below the DSH home that holds this plugin's own data. */
export const PLUGIN_HOME_DIRECTORY = 'wecom-bot';
/** The plugin's own Workspace directory, below {@link PLUGIN_HOME_DIRECTORY}. */
export const PLUGIN_WORKSPACE_DIRECTORY = 'workspace';
/** Sidebar title of the plugin's own Workspace. */
export const PLUGIN_WORKSPACE_TITLE = '企业微信';
/**
 * Persisted groups+bindings file version (4 = groups own Workspace, model and
 * preset; notes live on the person). A file of any other version is set aside
 * instead of migrated — there is no earlier deployment to keep working.
 */
export const ROUTING_VERSION = 4;
/** Upper bound on persisted members across all groups. */
export const MAX_BINDINGS = 500;
/** Upper bound on user groups. */
export const MAX_GROUPS = 20;
/** The built-in group that owns the plugin's default Workspace and model. */
export const DEFAULT_GROUP_ID = 'default';
export const DEFAULT_GROUP_NAME = '默认分组';
/** Longest accepted 备注 / group name, in characters. */
export const MAX_LABEL_CHARS = 60;

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

/** Why the Bot did not answer a sender. Authorization is group membership. */
export type RejectionReason = 'unauthorized';

export interface ModelSelection {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

/** How full a Session's context window is, as DSH's `contextPressure` fold sees it. */
export interface ContextUsage {
  /** Prompt-side tokens the next request will carry. */
  readonly used: number;
  /** The model's context window, when DSH reported one. */
  readonly window?: number;
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
  /** Agent preset the Session runs, when DSH reports one. */
  readonly preset?: string;
  readonly context?: ContextUsage;
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
 * Groups and members: one group owns Workspace+model, members route   *
 * ------------------------------------------------------------------ */

export type BindingKind = 'user' | 'group';

/**
 * A user group: the unit that owns a Workspace, a model and an agent preset.
 * The built-in {@link DEFAULT_GROUP_ID} group cannot be deleted and owns the
 * plugin's own Workspace unless it is pointed elsewhere.
 */
export interface GroupRecord {
  readonly id: string;
  readonly name: string;
  /** Workspace path; empty means the plugin's own Workspace. */
  readonly workspace: string;
  /** Model for every Session in this group; empty means the DSH default. */
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort: string;
  /** Agent preset for Sessions created in this group; empty means the DSH default. */
  readonly preset: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** One authorized WeCom principal: its group membership and its Session. */
export interface BindingRecord {
  readonly kind: BindingKind;
  /** userid for a private chat, chatid for a group. */
  readonly id: string;
  /** Membership: the group that decides Workspace and model. */
  readonly groupId: string;
  /** Bound Session id; empty means "create one on the next message". */
  readonly sessionId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Why a bound Session cannot be used as-is. */
export type BindingSessionState = 'bound' | 'auto' | 'blank' | 'missing' | 'archived' | 'unusable';

/** One member row inside a group card. */
export interface GroupMemberView {
  /** `user:<userid>` or `group:<chatid>`. */
  readonly key: string;
  readonly kind: BindingKind;
  readonly id: string;
  /** Operator note for this person; empty when unnamed. */
  readonly label: string;
  /** What the page shows: the note when set, the WeCom id otherwise. */
  readonly displayName: string;
  /** The sender is in the plugin's administrator list. */
  readonly admin: boolean;
  /** Configured Session id; empty means "create on the next message". */
  readonly sessionId: string;
  readonly sessionTitle: string | null;
  readonly sessionState: BindingSessionState;
  readonly sessionRunning: boolean;
  /** Model of the Session's latest request, when DSH reports one. */
  readonly sessionModel?: ModelSelection;
  /** Agent preset the bound Session runs, when DSH reports one. */
  readonly sessionPreset?: string;
  /** Context occupancy of the bound Session, when DSH reports one. */
  readonly sessionContext?: ContextUsage;
  readonly messages: number;
  readonly lastSeenAt?: number;
  readonly createdAt: number;
}

/** One group card: its Workspace/model/preset plus its members. */
export interface GroupView {
  readonly id: string;
  readonly name: string;
  /** The built-in group: always present, never deletable. */
  readonly isDefault: boolean;
  /** Configured Workspace path; empty means the plugin's own Workspace. */
  readonly workspace: string;
  readonly workspaceTitle: string;
  /** Effective absolute path; empty when unresolved. */
  readonly workspacePath: string;
  readonly workspaceError?: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
  /** Agent preset new Sessions in this group start with; empty means the DSH default. */
  readonly preset: string;
  /** Model a new Session in this group would use. */
  readonly effectiveProvider: string;
  readonly effectiveModel: string;
  readonly effectiveReasoningEffort?: string;
  readonly members: readonly GroupMemberView[];
  readonly memberCount: number;
  readonly messages: number;
  readonly lastSeenAt?: number;
}

/** One refused sender as the memory-only observation log knows it. */
export interface RejectedObservation {
  /** `user:<userid>` or `group:<chatid>`. */
  readonly key: string;
  readonly kind: BindingKind;
  readonly id: string;
  readonly chatType: 'single' | 'group';
  /** Latest rejected message, one line and length-bounded. */
  readonly text?: string;
  readonly messages: number;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
}

/**
 * A sender the Bot refused: it belongs to no group, so it was never answered.
 * Kept in memory only — the operator turns one into a member by assigning it
 * to a group, which is what authorizes it.
 */
export interface RejectedSenderView extends RejectedObservation {
  /** Operator note, when this person was known before being refused. */
  readonly label: string;
  /** The note when set, the WeCom id otherwise. */
  readonly displayName: string;
}

export interface RoutingView {
  readonly groups: readonly GroupView[];
  /** Total members across all groups. */
  readonly total: number;
  /** True when the store is at {@link MAX_BINDINGS} and refused new members. */
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
  /** Model a Session uses when its group picks none. */
  readonly dshDefault: ModelSelection | null;
  readonly failures: readonly { readonly id: string; readonly name: string; readonly message: string }[];
  readonly fetchedAt: number;
}

/** One selectable agent preset from DSH's preset roster. */
export interface AgentPresetOption {
  readonly id: string;
  /** Published name; empty for a shipped preset the page names itself. */
  readonly name?: string;
  readonly description?: string;
  /** The preset DSH uses for a Session whose group picks none. */
  readonly isDefault: boolean;
  /** Activation failure worth showing next to the choice. */
  readonly broken?: string;
}

export interface PresetCatalogView {
  readonly presets: readonly AgentPresetOption[];
  readonly fetchedAt: number;
}

export interface WorkspaceOption {  readonly id: string;
  readonly path: string;
  readonly title: string;
  /** The plugin's own Workspace under the DSH home. */
  readonly pluginOwned: boolean;
  /** Sessions that are not archived — the only ones that can notify anyone. */
  readonly sessionCount: number;
  /** Sessions the operator archived; hidden from the settings page. */
  readonly archivedSessionCount: number;
}

/** One administrator row: the Config grants the power, the store keeps the note. */
export interface AdminView {
  readonly id: string;
  /** Operator note; empty when unnamed. */
  readonly label: string;
  /** The note when set, the WeCom id otherwise. */
  readonly displayName: string;
  /** The group this administrator is also a member of, when they are one. */
  readonly groupName?: string;
}

/** Edits the settings page applies to groups and members. */
export type RoutingOp =
  | { readonly op: 'group.add'; readonly name?: string }
  | {
    readonly op: 'group.update';
    readonly id: string;
    readonly patch: {
      readonly name?: string;
      readonly workspace?: string;
      readonly provider?: string;
      readonly model?: string;
      readonly reasoningEffort?: string;
      readonly preset?: string;
    };
  }
  | { readonly op: 'group.delete'; readonly id: string }
  | {
    readonly op: 'member.add';
    readonly groupId: string;
    readonly kind: BindingKind;
    readonly id: string;
    readonly label?: string;
  }
  | {
    readonly op: 'member.update';
    readonly key: string;
    readonly patch: {
      readonly groupId?: string;
      readonly sessionId?: string;
    };
  }
  | { readonly op: 'member.remove'; readonly key: string }
  /**
   * Set (or clear) a person's 备注. Independent of membership: an
   * administrator who is in no group still has a name, and the note survives
   * being removed from a group.
   */
  | { readonly op: 'label.set'; readonly key: string; readonly label: string };

export interface RoutingRequest {
  readonly ops: readonly RoutingOp[];
}

export interface RoutingResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly routing?: RoutingView;
}

export interface BridgeStateView {
  readonly version: 4;
  readonly connection: ConnectionStatus;
  readonly traffic: TrafficStats;
  /** Senders refused since Host start, newest first. */
  readonly rejected: readonly RejectedSenderView[];
  readonly sessions: SessionCatalogView | null;
  readonly sessionsError?: string;
  readonly routing: RoutingView | null;
  readonly routingError?: string;
  readonly models: ModelCatalogView | null;
  readonly modelsError?: string;
  readonly presets: PresetCatalogView | null;
  readonly presetsError?: string;
  readonly workspaces: readonly WorkspaceOption[];
  readonly admins: readonly AdminView[];
  readonly adminWorkspaces: readonly string[];
  /** Non-fatal setup problems worth showing on the page. */
  readonly notices: readonly string[];
  readonly journal: JournalInfo;
}
