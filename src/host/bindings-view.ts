import type {
  BindingOp, BindingRecord, BindingSessionState, BindingView, BindingsView, ModelSelection,
} from '../shared/protocol.js';
import { bindingKey, parseBindingKey, validBindingId, type BindingStore } from './bindings.js';
import type { CatalogService } from './catalog.js';
import type { ModelService } from './models.js';
import type { ObservationStore } from './observation.js';
import type { SessionProvisioner, ModelDefaults } from './sessions.js';
import type { WorkspaceService } from './workspaces.js';
import type { Router } from './routing.js';

/**
 * The bindings table the settings page renders, and the edits it applies.
 *
 * The Host is the only writer of bindings: it creates one per conversation
 * on first contact. The page may adjust the Workspace, Session and model of
 * an existing binding (or pre-create one for a known WeCom id), but every
 * change is validated here — a Workspace must resolve, and a Session id is
 * only accepted for pre-binding, never invented by the browser.
 */

export interface BindingViewDeps {
  readonly bindings: BindingStore;
  readonly provisioner: SessionProvisioner;
  readonly workspaces: WorkspaceService;
  readonly models: ModelService;
  readonly catalogs: CatalogService;
  readonly observations?: ObservationStore;
  readonly defaults: () => ModelDefaults;
  readonly isAdmin: (user: string) => boolean;
  now?(): number;
}

interface Stats {
  readonly messages: number;
  readonly lastSeenAt?: number;
}

function statsBy(observations: ObservationStore | undefined): { users: Map<string, Stats>; chats: Map<string, Stats> } {
  const users = new Map<string, Stats>();
  const chats = new Map<string, Stats>();
  if (!observations) return { users, chats };
  const snapshot = observations.snapshot();
  for (const entry of snapshot.users) users.set(entry.id, { messages: entry.messages, lastSeenAt: entry.lastSeenAt });
  for (const entry of snapshot.chats) chats.set(entry.id, { messages: entry.messages, lastSeenAt: entry.lastSeenAt });
  return { users, chats };
}

export async function buildBindingsView(deps: BindingViewDeps): Promise<BindingsView> {
  const defaults = deps.defaults();
  const stats = statsBy(deps.observations);
  const items: BindingView[] = [];
  for (const binding of deps.bindings.list()) {
    items.push(await viewOf(deps, binding, defaults, stats));
  }
  items.sort((left, right) =>
    left.workspacePath.localeCompare(right.workspacePath)
    || (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0)
    || left.key.localeCompare(right.key));
  return { items, total: items.length, full: deps.bindings.full() };
}

async function viewOf(
  deps: BindingViewDeps,
  binding: BindingRecord,
  defaults: ModelDefaults,
  stats: { users: Map<string, Stats>; chats: Map<string, Stats> },
): Promise<BindingView> {
  const key = bindingKey(binding.kind, binding.id);
  let workspacePath = binding.workspace;
  let workspaceTitle = binding.workspace || '插件默认 Workspace';
  let workspaceError: string | undefined;
  try {
    const resolved = await deps.workspaces.describe(binding.workspace);
    workspacePath = resolved.path;
    workspaceTitle = resolved.title;
    if (!resolved.registered && !resolved.pluginOwned) workspaceError = '尚未注册为 DSH Workspace，将在创建会话时注册。';
  } catch (error) {
    workspaceError = error instanceof Error ? error.message : String(error);
    try {
      const fallback = await deps.workspaces.describe('');
      workspacePath = fallback.path;
      workspaceTitle = fallback.title;
    } catch { /* the page shows the error instead */ }
  }

  let sessionTitle: string | null = null;
  let sessionState: BindingSessionState = binding.sessionId ? 'bound' : 'auto';
  let sessionRunning = false;
  let sessionModel: ModelSelection | undefined;
  if (binding.sessionId) {
    const described = await deps.provisioner.describe(binding.sessionId);
    sessionTitle = described.title;
    sessionState = described.state;
    sessionRunning = described.running;
    sessionModel = described.model;
  }
  const desired = deps.provisioner.desired(binding, defaults) ?? sessionModel;
  const seen = binding.kind === 'user' ? stats.users.get(binding.id) : stats.chats.get(binding.id);
  return {
    key,
    kind: binding.kind,
    id: binding.id,
    ...(binding.note ? { note: binding.note } : {}),
    admin: binding.kind === 'user' && deps.isAdmin(binding.id),
    workspace: binding.workspace,
    workspaceTitle,
    workspacePath,
    ...(workspaceError ? { workspaceError } : {}),
    sessionId: binding.sessionId,
    sessionTitle,
    sessionState,
    sessionRunning,
    provider: binding.provider,
    model: binding.model,
    ...(binding.reasoningEffort ? { reasoningEffort: binding.reasoningEffort } : {}),
    ...(desired
      ? {
        effectiveProvider: desired.provider,
        effectiveModel: desired.model,
        ...(desired.reasoningEffort ? { effectiveReasoningEffort: desired.reasoningEffort } : {}),
      }
      : { effectiveProvider: '', effectiveModel: '' }),
    ...(sessionModel ? { sessionModel } : {}),
    messages: seen?.messages ?? 0,
    ...(seen?.lastSeenAt ? { lastSeenAt: seen.lastSeenAt } : {}),
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

export interface BindingOpResult {
  readonly ok: boolean;
  readonly error?: string;
  /** Number of bindings the ops changed. */
  readonly changed: number;
}

export interface BindingOpDeps {
  readonly bindings: BindingStore;
  readonly workspaces: WorkspaceService;
  readonly models: ModelService;
  readonly router: Pick<Router, 'reapplyModel'>;
  readonly log?: { warn(message: string): void };
}

/** Apply settings-page edits; the first failing op aborts the rest. */
export async function applyBindingOps(deps: BindingOpDeps, ops: readonly BindingOp[]): Promise<BindingOpResult> {
  let changed = 0;
  // A model edit is only worth accepting against the real catalog; read it
  // once when the page has never asked for it on this process yet.
  const touchesModel = ops.some(op => op.op === 'set' && (op.patch.provider !== undefined || op.patch.model !== undefined));
  if (touchesModel && !deps.models.snapshot()) {
    try {
      await deps.models.load();
    } catch {
      /* an unreadable catalog only means the model cannot be verified here */
    }
  }
  for (const op of ops.slice(0, 200)) {
    if (op.op === 'create') {
      const id = typeof op.id === 'string' ? op.id.trim() : '';
      if ((op.kind !== 'user' && op.kind !== 'group') || !validBindingId(id)) {
        return { ok: false, error: '需要有效的企微 userid（个人）或 chatid（群聊）。', changed };
      }
      const existing = deps.bindings.get(bindingKey(op.kind, id));
      if (existing) continue;
      try {
        await deps.bindings.create(op.kind, id);
        changed++;
      } catch (error) {
        return { ok: false, error: `无法新增绑定：${error instanceof Error ? error.message : String(error)}`, changed };
      }
      continue;
    }
    const parsed = parseBindingKey(op.key);
    if (!parsed) return { ok: false, error: `无法识别的绑定 id：${op.key}`, changed };
    const key = bindingKey(parsed.kind, parsed.id);
    const existing = deps.bindings.get(key);
    if (!existing) return { ok: false, error: `绑定不存在：${op.key}`, changed };
    if (op.op === 'delete') {
      await deps.bindings.remove(key);
      changed++;
      continue;
    }
    const patch = op.patch;
    if (patch.workspace !== undefined && patch.workspace.trim()) {
      try {
        await deps.workspaces.resolve(patch.workspace);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), changed };
      }
    }
    const nextProvider = (patch.provider ?? existing.provider).trim();
    const nextModel = (patch.model ?? existing.model).trim();
    if (nextProvider && nextModel && !deps.models.known({ provider: nextProvider, model: nextModel })) {
      return { ok: false, error: `DSH 当前没有模型 ${nextProvider}/${nextModel}，请重新选择。`, changed };
    }
    const updated = await deps.bindings.update(key, patch);
    if (!updated) return { ok: false, error: `绑定不存在：${op.key}`, changed };
    changed++;
    const modelChanged = (patch.provider !== undefined || patch.model !== undefined || patch.reasoningEffort !== undefined);
    if (modelChanged && updated.sessionId) {
      try {
        await deps.router.reapplyModel(updated);
      } catch (error) {
        deps.log?.warn(`WeCom could not apply the configured model: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { ok: true, changed };
}
