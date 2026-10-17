/**
 * DSH Host entry of the WeCom Bot plugin.
 *
 * Module map (src/host):
 *   config.ts         Config schema and normalized settings (policy, not routing)
 *   runtime.ts        Host-lifetime orchestration; rebuilds the bridge on change
 *   routing-store.ts  durable user groups + memberships (bindings.json)
 *   routing.ts        member → Session resolution for one conversation
 *   sessions.ts       Session provisioning: create, model selection, describe
 *   workspaces.ts     the Workspace new Sessions live in (own default, or configured)
 *   models.ts         DSH model catalog and Session-local model selection
 *   groups-view.ts    the groups table the settings page shows and edits
 *   bridge/           one live WeCom connection: inbound, commands, notices, outbox
 *   catalog.ts        DSH Sessions grouped by Workspace (archived/subagent hidden)
 *   observation.ts    refused senders, kept in memory for the page to authorize
 *   rounds.ts         per-message request/response records (round.complete)
 *   turns.ts          one finished DSH turn, summarized from the Session log
 *   journal.ts        JSONL journal under <DSH home>/wecom-bot/logs
 *   status.ts         connection phase and counters
 *   routes.ts         authenticated state and routing routes for the page
 */
import { readJournalSettings, type PluginConfig } from './config.js';
import type { HostContext, Logger } from './dsh.js';
import { createJournal, pluginHome } from './journal.js';
import { routingRoute, stateRoute } from './routes.js';
import { createRuntime, type Runtime } from './runtime.js';
import { join } from 'node:path';

export { Config } from './config.js';
export const inject = ['credentials', 'sessionController', 'connection'];

export function apply(ctx: HostContext, config: PluginConfig): void {
  const log: Logger = ctx.logger?.('wecom-bot') ?? console;
  ctx.effect(async () => {
    let runtime: Runtime | undefined;
    const journal = createJournal({
      directory: join(pluginHome(), 'logs'),
      enabled: () => readJournalSettings(config).enabled,
      retentionDays: () => readJournalSettings(config).retentionDays,
      secrets: () => runtime?.secrets() ?? [],
      onError: () => log.warn('WeCom journal write failed'),
    });
    runtime = createRuntime({ ctx, config, log, journal });
    journal.write({ event: 'plugin.start', pid: process.pid, node: process.version });
    const removeState = ctx.connection.fetch.register(stateRoute(runtime));
    const removeRouting = ctx.connection.fetch.register(routingRoute(runtime));
    try {
      await runtime.start();
    } catch (error) {
      log.error('WeCom setup failed (details in the plugin journal)');
      journal.write({ event: 'bridge.error', level: 'error', stage: 'start', error });
    }
    return async () => {
      await runtime?.stop();
      await removeState();
      await removeRouting();
      journal.write({ event: 'plugin.stop' });
      await journal.close();
    };
  });
}
