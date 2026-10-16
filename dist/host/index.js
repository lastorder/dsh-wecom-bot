/**
 * DSH Host entry of the WeCom Bot plugin.
 *
 * Module map (src/host):
 *   config.ts       Config schema and normalized settings
 *   runtime.ts      Host-lifetime orchestration; rebuilds the bridge on change
 *   bridge/         one live WeCom connection: inbound, commands, notices, outbox
 *   catalog.ts      DSH Sessions grouped by Workspace (archived/subagent hidden)
 *   observation.ts  WeCom users/conversations seen, including rejected ones
 *   rounds.ts       per-message request/response records (round.complete)
 *   journal.ts      JSONL journal under <DSH home>/wecom-bot/logs
 *   routes.ts       authenticated state route for the settings page
 */
import { readJournalSettings } from './config.js';
import { createJournal, pluginHome } from './journal.js';
import { stateRoute } from './routes.js';
import { createRuntime } from './runtime.js';
import { join } from 'node:path';
export { Config } from './config.js';
export const inject = ['credentials', 'sessionController', 'connection'];
export function apply(ctx, config) {
    const log = ctx.logger?.('wecom-bot') ?? console;
    ctx.effect(async () => {
        let runtime;
        const journal = createJournal({
            directory: join(pluginHome(), 'logs'),
            enabled: () => readJournalSettings(config).enabled,
            retentionDays: () => readJournalSettings(config).retentionDays,
            secrets: () => runtime?.secrets() ?? [],
            onError: () => log.warn('WeCom journal write failed'),
        });
        runtime = createRuntime({ ctx, config, log, journal });
        journal.write({ event: 'plugin.start', pid: process.pid, node: process.version });
        const removeRoute = ctx.connection.fetch.register(stateRoute(runtime));
        try {
            await runtime.start();
        }
        catch (error) {
            log.error('WeCom setup failed (details in the plugin journal)');
            journal.write({ event: 'bridge.error', level: 'error', stage: 'start', error });
        }
        return async () => {
            await runtime?.stop();
            await removeRoute();
            journal.write({ event: 'plugin.stop' });
            await journal.close();
        };
    });
}
//# sourceMappingURL=index.js.map