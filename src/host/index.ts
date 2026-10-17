/**
 * DSH Host entry of the WeCom Bot plugin.
 *
 * Module map (src/host):
 *   config.ts         Config schema: the connection identity only (Bot ID + the
 *                     reference to the Secret in DSH's credential store)
 *   runtime.ts        Host-lifetime orchestration; rebuilds the bridge only when
 *                     the connection identity moved, and hands it edited settings
 *   store.ts          the plugin's own document: the settings block + user groups +
 *                     memberships + notes + per-admin Workspace (settings.json)
 *   routing.ts        member → Session resolution for one conversation
 *   sessions.ts       Session provisioning: create, model selection, describe
 *   workspaces.ts     the Workspace new Sessions live in (own default, or configured)
 *   models.ts         DSH model catalog and Session-local model selection
 *   groups-view.ts    the groups table the settings page shows and edits, and the
 *                     validation every store op goes through
 *   session-title.ts  the `wecom-bot-<userid|chatid>` title every new Session gets
 *   bridge/           one live WeCom connection: inbound, commands, notices, outbox
 *   catalog.ts        DSH Sessions grouped by Workspace (archived/subagent hidden)
 *   observation.ts    refused senders, kept in memory for the page to authorize
 *   rounds.ts         per-message request/response records (round.complete)
 *   turns.ts          one finished DSH turn, summarized from the Session log
 *   journal.ts        JSONL journal under <DSH home>/wecom-bot/logs
 *   status.ts         connection phase and counters
 *   routes.ts         authenticated routes for the page: read state, apply store ops
 */
import type { PluginConfig } from './config.js';
import type { HostContext, Logger } from './dsh.js';
import { createJournal, pluginHome } from './journal.js';
import { storeRoute, stateRoute } from './routes.js';
import { createRuntime, type Runtime } from './runtime.js';
import { join } from 'node:path';

export { Config } from './config.js';
export const inject = ['credentials', 'sessionController', 'connection'];

export function apply(ctx: HostContext, config: PluginConfig): void {
  const log: Logger = ctx.logger?.('wecom-bot') ?? console;
  ctx.effect(async () => {
    let runtime: Runtime | undefined;
    // The journal's own settings live in the plugin store, like everything the
    // operator edits, so they are read through the runtime once it exists — and
    // they change live: no restart, no reconnect.
    const journal = createJournal({
      directory: join(pluginHome(), 'logs'),
      enabled: () => runtime?.journalSettings().enabled ?? true,
      retentionDays: () => runtime?.journalSettings().retentionDays ?? 14,
      secrets: () => runtime?.secrets() ?? [],
      onError: () => log.warn('WeCom journal write failed'),
    });
    runtime = createRuntime({ ctx, config, log, journal });
    const removeState = ctx.connection.fetch.register(stateRoute(runtime));
    const removeStore = ctx.connection.fetch.register(storeRoute(runtime));
    try {
      await runtime.start();
    } catch (error) {
      log.error('WeCom setup failed (details in the plugin journal)');
      journal.write({ event: 'bridge.error', level: 'error', stage: 'start', error });
    }
    // After `start`: the store is loaded by then, so a deployment that turned the
    // journal off does not get one line written before that is known.
    journal.write({ event: 'plugin.start', pid: process.pid, node: process.version });
    return async () => {
      await runtime?.stop();
      await removeState();
      await removeStore();
      journal.write({ event: 'plugin.stop' });
      await journal.close();
    };
  });
}
