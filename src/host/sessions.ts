import type { BindingSessionState, BindingRecord, GroupRecord, ModelSelection } from '../shared/protocol.js';
import type { CatalogService, SessionCatalog } from './catalog.js';
import type { SessionController } from './dsh.js';
import type { ModelService } from './models.js';
import type { WorkspaceService } from './workspaces.js';

/**
 * Session provisioning: turn a membership into a real DSH Session.
 *
 * A member without a Session id gets one the first time a message is routed
 * to it — created in its group's Workspace and, when the group configures a
 * model, with that model installed as the Session-local selection. Later
 * messages reuse the bound Session; only a Session that DSH reports as
 * archived, subagent-owned or gone is replaced, and the replacement is
 * persisted before the prompt is submitted.
 */

export interface SessionDescription {
  readonly title: string | null;
  readonly state: BindingSessionState;
  /** Workspace title, as the DSH sidebar shows it. */
  readonly workspace: string;
  /** Workspace directory; empty when DSH reported none. */
  readonly workspacePath: string;
  readonly running: boolean;
  readonly model?: ModelSelection;
}

export interface Provisioned {
  readonly sessionId: string;
  /** True when this call created the Session. */
  readonly created: boolean;
  readonly model?: ModelSelection;
}

export interface SessionProvisioner {
  /** The Session a member must use; creates and persists one when needed. */
  ensure(binding: BindingRecord, group: GroupRecord): Promise<Provisioned>;
  /** Install a Session-local model now (group model edits, session switches). */
  applyModel(sessionId: string, selection: ModelSelection): Promise<ModelSelection>;
  describe(sessionId: string): Promise<SessionDescription>;
  /** The model a group configures, or undefined for "leave it to DSH". */
  desired(group: GroupRecord): ModelSelection | undefined;
}

export interface SessionProvisionerOptions {
  readonly sessionController: Pick<SessionController, 'create' | 'selectModel'>;
  readonly models: ModelService;
  readonly workspaces: WorkspaceService;
  readonly catalogs: CatalogService;
  readonly bindings: { update(key: string, patch: { sessionId?: string }): Promise<unknown> };
  readonly bindingKey: (binding: BindingRecord) => string;
  /** How long a "missing Session" verdict is trusted before rebuilding the catalog. */
  readonly rebuildIntervalMs?: number;
  now?(): number;
  readonly journal?: { write(record: Record<string, unknown>): void };
  readonly log?: { warn(message: string): void };
}

/** The model configured on one group, or undefined when it follows DSH. */
export function desiredSelection(group: GroupRecord): ModelSelection | undefined {
  const provider = group.provider.trim();
  const model = group.model.trim();
  if (!provider || !model) return undefined;
  const reasoningEffort = group.reasoningEffort.trim();
  return { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

export function modelKey(selection: ModelSelection | undefined): string {
  return selection ? `${selection.provider}/${selection.model}${selection.reasoningEffort ? `#${selection.reasoningEffort}` : ''}` : '';
}

export function createSessionProvisioner(options: SessionProvisionerOptions): SessionProvisioner {
  const journal = options.journal ?? { write() {} };
  const log = options.log ?? { warn() {} };
  const now = options.now ?? Date.now;
  const applied = new Map<string, string>();
  /** Last forced catalog rebuild per Session: a missing Session stays missing,
   * so re-reading the whole DSH list on every settings-page poll would be
   * wasted work. One rebuild per window is enough to notice a new Session. */
  const rebuilt = new Map<string, number>();
  const REBUILD_INTERVAL_MS = options.rebuildIntervalMs ?? 30_000;

  async function freshCatalog(sessionId: string): Promise<SessionCatalog> {
    const last = rebuilt.get(sessionId) ?? 0;
    if (now() - last < REBUILD_INTERVAL_MS) return await options.catalogs.load();
    rebuilt.set(sessionId, now());
    return await options.catalogs.load({ force: true });
  }

  /** How usable a bound Session id currently is, per the DSH catalog. */
  async function classify(sessionId: string): Promise<BindingSessionState> {
    const reason = (catalog: SessionCatalog): BindingSessionState | undefined => {
      const hidden = catalog.hiddenReason(sessionId);
      if (hidden === undefined) return 'bound';
      if (hidden === 'blank') return 'blank'; // created, never prompted: still ours
      if (hidden === 'archived') return 'archived';
      if (hidden === 'subagent') return 'unusable';
      return undefined; // missing: refresh once below
    };
    try {
      const first = reason(await options.catalogs.load());
      if (first) return first;
      const second = reason(await freshCatalog(sessionId));
      return second ?? 'missing';
    } catch {
      // The catalog is unavailable: trust the stored id and let the prompt decide.
      return 'bound';
    }
  }

  async function install(sessionId: string, selection: ModelSelection, force: boolean): Promise<ModelSelection | undefined> {
    const key = modelKey(selection);
    if (!force && applied.get(sessionId) === key) return undefined;
    const selected = await options.models.select(sessionId, selection);
    applied.set(sessionId, modelKey(selected));
    return selected;
  }

  return {
    desired: desiredSelection,
    async ensure(binding, group) {
      const selection = desiredSelection(group);
      if (binding.sessionId) {
        const state = await classify(binding.sessionId);
        if (state === 'bound' || state === 'blank') {
          // An explicit model change takes effect with the next message.
          const model = selection ? await install(binding.sessionId, selection, false).catch(error => {
            log.warn(`WeCom could not select the Session model: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
          }) : undefined;
          return { sessionId: binding.sessionId, created: false, ...(model ? { model } : {}) };
        }
        journal.write({
          event: 'binding.session.replaced', level: 'warn',
          binding: options.bindingKey(binding), sessionId: binding.sessionId, state,
        });
      }
      const workspace = await options.workspaces.resolve(group.workspace);
      const created = await options.sessionController.create(
        workspace.id ? { workspaceId: workspace.id } : { cwd: workspace.path },
      );
      await options.bindings.update(options.bindingKey(binding), { sessionId: created.sessionId });
      journal.write({
        event: 'binding.session.created', binding: options.bindingKey(binding),
        sessionId: created.sessionId, workspace: workspace.path, workspaceId: workspace.id,
        group: group.id, model: selection ?? null,
      });
      let model: ModelSelection | undefined;
      if (selection) {
        try {
          model = await install(created.sessionId, selection, true);
        } catch (error) {
          log.warn(`WeCom could not select the Session model: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return { sessionId: created.sessionId, created: true, ...(model ? { model } : {}) };
    },
    async applyModel(sessionId, selection) {
      return await install(sessionId, selection, true) ?? selection;
    },
    async describe(sessionId) {
      try {
        const catalog = await options.catalogs.load();
        const entry = catalog.get(sessionId) ?? (await freshCatalog(sessionId)).get(sessionId);
        if (entry) {
          return {
            title: entry.title,
            state: 'bound',
            workspace: entry.group.title,
            workspacePath: entry.group.path ?? '',
            running: entry.running,
            ...(entry.model ? { model: entry.model } : {}),
          };
        }
        const hidden = catalog.hiddenReason(sessionId);
        return {
          title: catalog.titleOf(sessionId),
          state: hidden === undefined ? 'missing' : hidden === 'subagent' ? 'unusable' : hidden,
          workspace: '', workspacePath: '', running: false,
        };
      } catch {
        return { title: null, state: 'missing', workspace: '', workspacePath: '', running: false };
      }
    },
  };
}
