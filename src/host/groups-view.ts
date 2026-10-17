import {
  DEFAULT_GROUP_ID, MAX_GROUPS, type BindingKind, type BindingRecord, type BindingSessionState, type ContextUsage,
  type GroupMemberView, type GroupRecord, type GroupView, type ModelSelection, type RoutingOp,
  type RoutingView,
} from '../shared/protocol.js';
import type { CatalogService } from './catalog.js';
import type { ModelService } from './models.js';
import type { PresetService } from './presets.js';
import type { ObservationStore } from './observation.js';
import { bindingKey, normalizeLabel, parseBindingKey, validBindingId, type RoutingStore } from './routing-store.js';
import type { Router } from './routing.js';
import type { SessionProvisioner } from './sessions.js';
import type { WorkspaceService } from './workspaces.js';

/**
 * The groups table the settings page renders, and the edits it applies.
 *
 * The Host is the only writer of membership while the Bot runs (it records an
 * implicit membership for an administrator who was never added), and the page
 * is the only way to authorize anyone else — assigning a rejected sender to a
 * group *is* the authorization. Every change is validated here: a group must
 * exist, a Workspace must resolve, and a model and an agent preset must exist
 * in the DSH catalogs.
 */

export interface RoutingViewDeps {
  readonly store: RoutingStore;
  readonly provisioner: SessionProvisioner;
  readonly workspaces: WorkspaceService;
  readonly models: ModelService;
  readonly presets?: PresetService;
  readonly catalogs: CatalogService;
  readonly observations?: ObservationStore;
  readonly isAdmin: (user: string) => boolean;
  readonly router?: Pick<Router, 'reapplyGroup'>;
  /** Archiving a Session needs a DSH service the view itself does not hold. */
  readonly ops?: { archive(sessionId: string): Promise<void> };
  readonly log?: { warn(message: string): void };
}

async function memberView(deps: RoutingViewDeps, binding: BindingRecord): Promise<GroupMemberView> {
  const key = bindingKey(binding.kind, binding.id);
  let sessionTitle: string | null = null;
  let sessionState: BindingSessionState = binding.sessionId ? 'bound' : 'auto';
  let sessionRunning = false;
  let sessionModel: ModelSelection | undefined;
  let sessionPreset: string | undefined;
  let sessionContext: ContextUsage | undefined;
  if (binding.sessionId) {
    const described = await deps.provisioner.describe(binding.sessionId);
    sessionTitle = described.title;
    sessionState = described.state;
    sessionRunning = described.running;
    sessionModel = described.model;
    sessionPreset = described.preset;
    sessionContext = described.context;
  }
  const seen = deps.observations?.stats(binding.kind, binding.id);
  return {
    key,
    kind: binding.kind,
    id: binding.id,
    label: deps.store.label(key),
    displayName: deps.store.label(key) || binding.id,
    admin: binding.kind === 'user' && deps.isAdmin(binding.id),
    sessionId: binding.sessionId,
    sessionTitle,
    sessionState,
    sessionRunning,
    ...(sessionModel ? { sessionModel } : {}),
    ...(sessionPreset ? { sessionPreset } : {}),
    ...(sessionContext ? { sessionContext } : {}),
    messages: seen?.messages ?? 0,
    ...(seen?.lastSeenAt ? { lastSeenAt: seen.lastSeenAt } : {}),
    createdAt: binding.createdAt,
  };
}

async function groupView(deps: RoutingViewDeps, group: GroupRecord): Promise<GroupView> {
  let workspacePath = group.workspace;
  let workspaceTitle = group.workspace ? group.workspace : '插件默认 Workspace';
  let workspaceError: string | undefined;
  try {
    const resolved = await deps.workspaces.describe(group.workspace);
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
  const members: GroupMemberView[] = [];
  for (const binding of deps.store.inGroup(group.id)) members.push(await memberView(deps, binding));
  members.sort((left, right) =>
    (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0)
    || left.displayName.localeCompare(right.displayName)
    || left.key.localeCompare(right.key));
  const desired = deps.provisioner.desired(group);
  const lastSeenAt = members.reduce<number | undefined>(
    (latest, member) => (member.lastSeenAt && (!latest || member.lastSeenAt > latest) ? member.lastSeenAt : latest), undefined);
  return {
    id: group.id,
    name: group.name,
    isDefault: group.id === DEFAULT_GROUP_ID,
    workspace: group.workspace,
    workspaceTitle,
    workspacePath,
    ...(workspaceError ? { workspaceError } : {}),
    provider: group.provider,
    model: group.model,
    ...(group.reasoningEffort ? { reasoningEffort: group.reasoningEffort } : {}),
    preset: group.preset,
    ...(desired
      ? {
        effectiveProvider: desired.provider,
        effectiveModel: desired.model,
        ...(desired.reasoningEffort ? { effectiveReasoningEffort: desired.reasoningEffort } : {}),
      }
      : { effectiveProvider: '', effectiveModel: '' }),
    members,
    memberCount: members.length,
    messages: members.reduce((sum, member) => sum + member.messages, 0),
    ...(lastSeenAt ? { lastSeenAt } : {}),
  };
}

/** Groups: the built-in default group first, then the others oldest first. */
export async function buildRoutingView(deps: RoutingViewDeps): Promise<RoutingView> {
  const records = deps.store.groups();
  const ordered = [
    ...records.filter(group => group.id === DEFAULT_GROUP_ID),
    ...records.filter(group => group.id !== DEFAULT_GROUP_ID).sort((left, right) => left.createdAt - right.createdAt),
  ];
  const groups: GroupView[] = [];
  for (const group of ordered) groups.push(await groupView(deps, group));
  return {
    groups,
    total: deps.store.bindings().length,
    full: deps.store.full(),
  };
}

export interface RoutingOpResult {
  readonly ok: boolean;
  readonly error?: string;
  /** Number of records the ops changed. */
  readonly changed: number;
  /** The group `group.add` created, so the page can open its form. */
  readonly createdGroupId?: string;
  /** Principals `member.add` authorized, so the Bot can greet them. */
  readonly authorized?: readonly { readonly kind: BindingKind; readonly id: string; readonly groupId: string }[];
}

/** Apply settings-page edits; the first failing op aborts the rest. */
export async function applyRoutingOps(deps: RoutingViewDeps, ops: readonly RoutingOp[]): Promise<RoutingOpResult> {
  let changed = 0;
  let createdGroupId: string | undefined;
  const authorized: { kind: BindingKind; id: string; groupId: string }[] = [];
  // A model edit is only worth accepting against the real catalog; read it
  // once when the page has never asked for it on this process yet.
  const touchesModel = ops.some(op => op.op === 'group.update'
    && (op.patch.provider !== undefined || op.patch.model !== undefined));
  if (touchesModel && !deps.models.snapshot()) {
    try {
      await deps.models.load();
    } catch {
      /* an unreadable catalog only means the model cannot be verified here */
    }
  }
  // A preset edit is accepted only against the real roster, for the same reason
  // as a model: a typo would otherwise fail the next Session creation instead.
  const touchesPreset = ops.some(op => op.op === 'group.update' && op.patch.preset !== undefined);
  if (touchesPreset && !deps.presets?.snapshot()) {
    try {
      await deps.presets?.load();
    } catch {
      /* an unreadable roster only means the preset cannot be verified here */
    }
  }
  const modelChanged = new Set<string>();
  for (const op of ops.slice(0, 200)) {
    switch (op.op) {
      case 'group.add': {
        if (deps.store.groups().length >= MAX_GROUPS) {
          return { ok: false, error: `最多只能有 ${MAX_GROUPS} 个分组。`, changed };
        }
        try {
          const created = await deps.store.createGroup(op.name);
          createdGroupId = created.id;
          changed++;
        } catch (error) {
          return { ok: false, error: `无法新增分组：${error instanceof Error ? error.message : String(error)}`, changed };
        }
        break;
      }
      case 'group.update': {
        const group = deps.store.group(op.id);
        if (!group) return { ok: false, error: `分组不存在：${op.id}`, changed };
        const patch = op.patch;
        if (patch.workspace !== undefined && patch.workspace.trim()) {
          try {
            await deps.workspaces.resolve(patch.workspace);
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error), changed };
          }
        }
        const nextProvider = (patch.provider ?? group.provider).trim();
        const nextModel = (patch.model ?? group.model).trim();
        if (Boolean(nextProvider) !== Boolean(nextModel)) {
          return { ok: false, error: '请同时选择服务商与模型，或都留空以跟随 DSH 默认模型。', changed };
        }
        if (nextProvider && nextModel && !deps.models.known({ provider: nextProvider, model: nextModel })) {
          return { ok: false, error: `DSH 当前没有模型 ${nextProvider}/${nextModel}，请重新选择。`, changed };
        }
        const nextPreset = (patch.preset ?? group.preset).trim();
        // Without a preset service there is nothing to validate against.
        if (nextPreset && deps.presets && !deps.presets.known(nextPreset)) {
          return { ok: false, error: `DSH 当前没有 preset ${nextPreset}，请重新选择。`, changed };
        }
        const updated = await deps.store.updateGroup(op.id, patch);
        if (!updated) return { ok: false, error: `分组不存在：${op.id}`, changed };
        changed++;
        if (patch.provider !== undefined || patch.model !== undefined || patch.reasoningEffort !== undefined) {
          modelChanged.add(op.id);
        }
        // A group's Workspace defines where its Sessions live, so moving the
        // group must not leave members pointing at Sessions of the old one.
        if (updated.workspace !== group.workspace) {
          for (const member of deps.store.inGroup(op.id)) {
            if (!member.sessionId) continue;
            await deps.store.update(bindingKey(member.kind, member.id), { sessionId: '' });
            changed++;
          }
        }
        break;
      }
      case 'group.delete': {
        if (op.id === DEFAULT_GROUP_ID) return { ok: false, error: '默认分组不能删除。', changed };
        const result = await deps.store.removeGroup(op.id);
        if (!result.ok) return { ok: false, error: `分组不存在：${op.id}`, changed };
        changed += 1 + result.removed;
        break;
      }
      case 'member.add': {
        const id = typeof op.id === 'string' ? op.id.trim() : '';
        if ((op.kind !== 'user' && op.kind !== 'group') || !validBindingId(id)) {
          return { ok: false, error: '需要有效的企微 userid（个人）或 chatid（群聊）。', changed };
        }
        if (!deps.store.group(op.groupId)) return { ok: false, error: `分组不存在：${op.groupId}`, changed };
        try {
          await deps.store.create(op.kind, id, { groupId: op.groupId, ...(op.label === undefined ? {} : { label: op.label }) });
          authorized.push({ kind: op.kind, id, groupId: op.groupId });
          changed++;
        } catch (error) {
          return { ok: false, error: `无法加入分组：${error instanceof Error ? error.message : String(error)}`, changed };
        }
        break;
      }
      case 'member.update': {
        const parsed = parseBindingKey(op.key);
        if (!parsed) return { ok: false, error: `无法识别的成员 id：${op.key}`, changed };
        const key = bindingKey(parsed.kind, parsed.id);
        if (!deps.store.get(key)) return { ok: false, error: `成员不存在：${op.key}`, changed };
        if (op.patch.groupId !== undefined && !deps.store.group(op.patch.groupId)) {
          return { ok: false, error: `分组不存在：${op.patch.groupId}`, changed };
        }
        const updated = await deps.store.update(key, op.patch);
        if (!updated) return { ok: false, error: `成员不存在：${op.key}`, changed };
        changed++;
        break;
      }
      case 'label.set': {
        const parsed = parseBindingKey(op.key);
        if (!parsed) return { ok: false, error: `无法识别的人员 id：${op.key}`, changed };
        const key = bindingKey(parsed.kind, parsed.id);
        if (typeof op.label !== 'string') return { ok: false, error: '备注必须是文本。', changed };
        if (op.label.trim() && !normalizeLabel(op.label)) {
          return { ok: false, error: '备注只能是单行文本。', changed };
        }
        await deps.store.setLabel(key, op.label);
        changed++;
        break;
      }
      case 'member.archive': {
        const parsed = parseBindingKey(op.key);
        if (!parsed) return { ok: false, error: `无法识别的成员 id：${op.key}`, changed };
        const key = bindingKey(parsed.kind, parsed.id);
        const binding = deps.store.get(key);
        if (!binding) return { ok: false, error: `成员不存在：${op.key}`, changed };
        if (!binding.sessionId) return { ok: false, error: '这个成员还没有会话可以归档。', changed };
        if (!deps.ops) return { ok: false, error: '当前 DSH 不支持归档会话。', changed };
        try {
          await deps.ops.archive(binding.sessionId);
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error), changed };
        }
        // Clearing the binding is what makes the next message create a fresh
        // Session from the group's current Workspace/model/preset.
        await deps.store.update(key, { sessionId: '' });
        changed++;
        break;
      }
      case 'member.remove': {
        const parsed = parseBindingKey(op.key);
        if (!parsed) return { ok: false, error: `无法识别的成员 id：${op.key}`, changed };
        const removed = await deps.store.remove(bindingKey(parsed.kind, parsed.id));
        if (!removed) return { ok: false, error: `成员不存在：${op.key}`, changed };
        changed++;
        break;
      }
      default:
        return { ok: false, error: '未知的修改类型。', changed };
    }
  }
  // A group's model applies to every Session it already owns.
  for (const id of modelChanged) {
    try {
      await deps.router?.reapplyGroup(id);
    } catch (error) {
      deps.log?.warn(`WeCom could not apply the group model: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    ok: true, changed,
    ...(createdGroupId ? { createdGroupId } : {}),
    ...(authorized.length ? { authorized } : {}),
  };
}
