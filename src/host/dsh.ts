/**
 * Local mirrors of the DSH Host contracts this plugin consumes.
 *
 * Only the members actually used are declared. Shapes come from DSH Inspect
 * and the packaged sources: `session/event` (emit), `user-questions/request`
 * and `approval/request` (waterfall), `ctx.sessionController`,
 * `ctx.workspaceRegistry`, `ctx.credentials` and `ctx.connection.fetch`.
 */

export interface ContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly name?: string;
  readonly [key: string]: unknown;
}

/** A committed Session log event (`type`, `seq`, `time`, `data`). */
export interface SessionEvent {
  readonly type: string;
  readonly seq?: number;
  readonly time?: number;
  readonly data?: {
    readonly turn?: number;
    readonly step?: number;
    readonly reason?: { readonly kind: string; readonly [key: string]: unknown };
    readonly title?: string;
    readonly name?: string;
    readonly content?: readonly ContentBlock[];
    readonly source?: { readonly kind: string; readonly rpcId?: string };
    readonly message?: { readonly role?: string; readonly content?: readonly ContentBlock[] };
    readonly header?: { readonly config?: { readonly provider?: string; readonly model?: string; readonly reasoningEffort?: string } };
    readonly provider?: string;
    readonly model?: string;
    readonly [key: string]: unknown;
  };
}

export interface SessionHandle {
  readonly id: string;
  snapshotEvents(): readonly SessionEvent[];
}

export interface QuestionOption { readonly label: string; readonly description?: string }

export interface Question {
  readonly id: string;
  readonly question: string;
  readonly header?: string;
  readonly detail?: string;
  readonly intent?: { readonly kind: string; readonly approve?: string; readonly callId?: string };
  readonly options?: readonly QuestionOption[];
  readonly multiSelect?: boolean;
}

export interface QuestionAnswerItem {
  readonly id: string;
  readonly selected: string[];
  readonly custom?: string;
}

export interface QuestionAnswer { readonly answers: QuestionAnswerItem[] }

export interface QuestionRequest {
  readonly agent?: { readonly id: string };
  readonly questions: readonly Question[];
  readonly signal?: AbortSignal;
}

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

export interface ApprovalRequest {
  readonly agent?: { readonly id: string };
  readonly toolName: string;
  readonly callId?: string;
  readonly reason?: string;
  readonly displayReason?: { readonly en?: string; readonly zh?: string };
  readonly signal?: AbortSignal;
}

export interface PromptRequest {
  readonly requestId: string;
  readonly sessionId: string;
  readonly mode: 'queue';
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
}

/** One row of `sessionController.list`; every field but the id may be absent. */
export interface SessionSummary {
  readonly sessionId: string;
  readonly updatedAt?: number;
  readonly running?: boolean;
  readonly blank?: boolean;
  readonly origin?: string;
  readonly parentSessionId?: string;
  readonly cwd?: string;
  readonly projections?: {
    readonly values?: {
      readonly title?: string | null;
      readonly modelSelection?: { readonly lastUsed?: unknown; readonly next?: unknown } | null;
      /** Preset projection: the preset the Session actually runs. */
      readonly agentPreset?: string | null;
      /** Token meter's occupancy fold: prompt-side tokens against the window. */
      readonly contextPressure?: {
        readonly contextWindow?: number;
        readonly pressureTokens?: number;
        readonly projectedTokens?: number;
      } | null;
      readonly [key: string]: unknown;
    };
  };
}

export interface ModelSelectionValue {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

export interface DiscoveredModel {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly reasoning?: {
    readonly efforts: readonly { readonly id: string; readonly name: string; readonly description?: string }[];
    readonly defaultEffort?: string;
  };
}

export interface ModelProviderGroup {
  readonly id: string;
  readonly name: string;
  readonly models: readonly DiscoveredModel[];
}

export interface ModelCatalog {
  readonly default: ModelSelectionValue;
  readonly routableProviders: readonly string[];
  readonly groups: readonly ModelProviderGroup[];
  readonly failures: readonly { readonly id: string; readonly name: string; readonly message: string }[];
}

export interface SessionCreateRequest {
  readonly workspaceId?: string;
  readonly cwd?: string;
  readonly sessionId?: string;
  /** Agent preset to compose the Session with; omitted means the DSH default. */
  readonly agentPreset?: string;
}

export interface SessionController {
  prompt(request: PromptRequest, signal: AbortSignal): Promise<unknown>;
  cancel(request: { readonly sessionId: string }): unknown;
  list(request: Record<string, never>, signal: AbortSignal): Promise<{ readonly items: readonly SessionSummary[] }>;
  /** Create (or idempotently adopt) one ordinary Session. */
  create(request: SessionCreateRequest): Promise<{ readonly sessionId: string; readonly agentPreset?: string }>;
  /** Install a Session-local model; also saves the deployment default. */
  selectModel(request: ModelSelectionValue & { readonly sessionId: string }): Promise<{ readonly selected: ModelSelectionValue }>;
  /** Every currently routable provider/model pair. */
  modelCatalog(): Promise<ModelCatalog>;
}

/** `ctx.agentDefaultModel`: the deployment-wide default model selection. */
export interface AgentDefaultModel {
  currentSelection(): ModelSelectionValue;
  saveSelection(next: ModelSelectionValue): Promise<void>;
}

/** One declared agent preset (`ctx.get('agentPresets')`); `name` is unset for shipped ones. */
export interface AgentPresetRow {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  /** Activation failure; the preset stays listed but cannot start a Session. */
  readonly broken?: string;
}

/** `ctx.agentPresets`: the roster a Session's preset must come from. */
export interface AgentPresetRegistry {
  list(): Promise<readonly AgentPresetRow[]>;
  /** Metadata of one preset, or of the default when `id` is omitted. */
  resolve(id?: string): Promise<AgentPresetRow>;
}

export interface WorkspaceEntity {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly sessionIds: readonly string[];
}

export interface WorkspaceRegistry {
  list(): readonly WorkspaceEntity[];
  get(id: string): WorkspaceEntity | undefined;
  /** Register (or reuse) the Workspace owning an existing directory. */
  create(path: string, title?: string): Promise<WorkspaceEntity>;
  /** The registered Workspace owning a canonical path, when one exists. */
  resolveByPath(path: string): Promise<WorkspaceEntity | undefined>;
  readonly archivedSessionIds: readonly string[];
  readonly pinnedSessionIds: readonly string[];
}

export interface Logger {
  info?(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type Disposer = () => void;

export interface DshEvents {
  on(event: 'session/event', listener: (session: SessionHandle, event: SessionEvent) => void): Disposer | void;
  on(event: 'user-questions/request', listener: (request: QuestionRequest, next: () => Promise<QuestionAnswer>) => Promise<QuestionAnswer>): Disposer | void;
  on(event: 'approval/request', listener: (request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>): Disposer | void;
  on(event: 'app-boot/config-reload', listener: () => void): Disposer | void;
  on(event: 'credentials/reference-updated', listener: (ref: string) => void): Disposer | void;
}

export interface FetchRoute {
  readonly path: string;
  readonly methods: readonly ('GET' | 'HEAD' | 'POST')[];
  readonly requestBody: 'buffered' | 'streaming';
  readonly fetch: (request: Request) => Promise<Response>;
}

export interface HostContext extends DshEvents {
  readonly sessionController: SessionController;
  readonly credentials: { resolve(ref: string): Promise<{ readonly value: string } | undefined> };
  readonly connection: { readonly fetch: { register(route: FetchRoute): () => Promise<void> } };
  /** Cordis service lookup without an inject declaration (optional services). */
  get?(name: string): unknown;
  logger?(namespace: string): Logger;
  effect(setup: () => Promise<() => Promise<void>>): unknown;
}
