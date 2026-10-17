import { DEFAULT_GROUP_ID, type BindingRecord, type GroupRecord } from '../shared/protocol.js';
import { bindingKey, bindingKeyFor, type BindingKeyParts, type RoutingStore } from './routing-store.js';
import type { SessionProvisioner } from './sessions.js';

/**
 * Routing: which Session one WeCom conversation talks to.
 *
 * Every authorized private chat owns the Session bound to its sender, every
 * authorized group owns the Session bound to the group — members can never
 * reach another conversation's Session. Membership is durable, so routing
 * survives a Host restart instead of depending on who happened to message the
 * Bot since it started. The group a member belongs to decides the Workspace
 * and the model; the member row decides the Session.
 */

export interface RouteResult {
  readonly ok: boolean;
  readonly binding?: BindingRecord;
  readonly group?: GroupRecord;
  readonly sessionId?: string;
  /** True when this call created the Session. */
  readonly created?: boolean;
  /** Operator-facing explanation of a failed route. */
  readonly message?: string;
}

export interface Router {
  /** The member row for a conversation, authorized into `groupId` when new. */
  ensure(parts: BindingKeyParts, groupId: string): Promise<BindingRecord>;
  /** The Session a plain message from this conversation must be submitted to. */
  route(parts: BindingKeyParts, groupId: string): Promise<RouteResult>;
  /** Every member currently pointing at one Session. */
  forSession(sessionId: string): readonly BindingRecord[];
  /** Re-install the group's model on every Session of that group. */
  reapplyGroup(groupId: string): Promise<void>;
  /** The group that decides Workspace and model for one member. */
  groupOf(binding: BindingRecord): GroupRecord;
  readonly store: RoutingStore;
  readonly provisioner: SessionProvisioner;
}

export interface RouterOptions {
  readonly store: RoutingStore;
  readonly provisioner: SessionProvisioner;
  readonly log?: { warn(message: string): void };
}

export function routerKey(binding: BindingRecord): string {
  return bindingKey(binding.kind, binding.id);
}

export function createRouter(options: RouterOptions): Router {
  const { store, provisioner } = options;

  function groupOf(binding: BindingRecord): GroupRecord {
    return store.group(binding.groupId) ?? store.group(DEFAULT_GROUP_ID)!;
  }

  async function ensure(parts: BindingKeyParts, groupId: string): Promise<BindingRecord> {
    const existing = store.get(bindingKeyFor(parts));
    if (existing) return existing;
    return await store.create(
      parts.chatType === 'group' ? 'group' : 'user',
      parts.chatType === 'group' ? parts.chat : parts.user,
      { groupId },
    );
  }

  return {
    store,
    provisioner,
    ensure,
    groupOf,
    async route(parts, groupId) {
      let binding: BindingRecord;
      try {
        binding = await ensure(parts, groupId);
      } catch (error) {
        return { ok: false, message: error instanceof Error && /limit/.test(error.message)
          ? '成员数量已达上限，请在配置页清理后再试。'
          : '无法创建成员记录，请查看插件日志。' };
      }
      const group = groupOf(binding);
      try {
        const provisioned = await provisioner.ensure(binding, group);
        return {
          ok: true, binding: store.get(bindingKey(binding.kind, binding.id)) ?? binding, group,
          sessionId: provisioned.sessionId, created: provisioned.created,
        };
      } catch (error) {
        options.log?.warn(`WeCom could not create a Session: ${error instanceof Error ? error.message : String(error)}`);
        return {
          ok: false, binding, group,
          // The Workspace, the preset and the model all take part in creating a
          // Session, so name the group rather than guessing which one failed.
          message: `无法在分组「${group.name}」中创建会话：${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
    forSession: sessionId => store.forSession(sessionId),
    async reapplyGroup(groupId) {
      const group = store.group(groupId);
      if (!group) return;
      const selection = provisioner.desired(group);
      if (!selection) return;
      for (const binding of store.inGroup(groupId)) {
        if (!binding.sessionId) continue;
        try {
          await provisioner.applyModel(binding.sessionId, selection);
        } catch (error) {
          options.log?.warn(`WeCom could not apply the group model: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
  };
}
