import type { BindingRecord } from '../shared/protocol.js';
import type { BindingKeyParts, BindingStore } from './bindings.js';
import { bindingKey, bindingKeyFor } from './bindings.js';
import type { SessionProvisioner, ModelDefaults } from './sessions.js';

/**
 * Routing: which Session one WeCom conversation talks to.
 *
 * Every accepted private chat owns the Session bound to its sender, every
 * group owns the Session bound to the group — non-admins can never reach
 * another conversation's Session. Bindings are created on first contact and
 * persisted, so routing survives a Host restart instead of depending on
 * who happened to message the Bot since it started.
 */

export interface RouteResult {
  readonly ok: boolean;
  readonly binding?: BindingRecord;
  readonly sessionId?: string;
  /** True when this call created the Session. */
  readonly created?: boolean;
  /** Operator-facing explanation of a failed route. */
  readonly message?: string;
}

export interface Router {
  /** The persisted binding for a conversation, created empty when new. */
  ensure(parts: BindingKeyParts): Promise<BindingRecord>;
  /** The Session a plain message from this conversation must be submitted to. */
  route(parts: BindingKeyParts): Promise<RouteResult>;
  /** Every binding currently pointing at one Session. */
  forSession(sessionId: string): readonly BindingRecord[];
  /** Re-install the configured model on one bound Session. */
  reapplyModel(binding: BindingRecord): Promise<void>;
  readonly store: BindingStore;
  readonly provisioner: SessionProvisioner;
}

export interface RouterOptions {
  readonly store: BindingStore;
  readonly provisioner: SessionProvisioner;
  readonly defaults: () => ModelDefaults;
  readonly log?: { warn(message: string): void };
}

export function routerKey(binding: BindingRecord): string {
  return bindingKey(binding.kind, binding.id);
}

export function createRouter(options: RouterOptions): Router {
  const { store, provisioner } = options;

  async function ensure(parts: BindingKeyParts): Promise<BindingRecord> {
    const existing = store.get(bindingKeyFor(parts));
    return existing ?? await store.ensure(parts);
  }

  return {
    store,
    provisioner,
    ensure,
    async route(parts) {
      let binding: BindingRecord;
      try {
        binding = await ensure(parts);
      } catch (error) {
        return { ok: false, message: error instanceof Error && /limit/.test(error.message)
          ? '本插件的会话绑定数量已达上限，请在配置页清理后再试。'
          : '无法创建会话绑定，请查看插件日志。' };
      }
      try {
        const provisioned = await provisioner.ensure(binding, options.defaults());
        return {
          ok: true, binding: store.get(bindingKey(binding.kind, binding.id)) ?? binding,
          sessionId: provisioned.sessionId, created: provisioned.created,
        };
      } catch (error) {
        options.log?.warn(`WeCom could not create a Session: ${error instanceof Error ? error.message : String(error)}`);
        return {
          ok: false, binding,
          message: `无法为你在 Workspace 中创建会话：${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
    forSession: sessionId => store.forSession(sessionId),
    async reapplyModel(binding) {
      const selection = provisioner.desired(binding, options.defaults());
      if (!selection || !binding.sessionId) return;
      try {
        await provisioner.applyModel(binding.sessionId, selection);
      } catch (error) {
        options.log?.warn(`WeCom could not apply the configured model: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
