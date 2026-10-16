/**
 * Browser half of the WeCom Bot plugin: the plugin homepage.
 *
 * The DSH Web shell loads `dist/client.js`, a CommonJS bundle wrapped in
 * `window.__ModuleLoader__.load({ id, factory })` by scripts/build-client.mjs.
 * `react`, `react/jsx-runtime` and `@deepseek-ai/dsh-client-ui-primitives`
 * stay external: the shell supplies them through the factory's `require`.
 *
 * Module map (src/client):
 *   index.tsx        registration on the `plugins.bundle.config` slot
 *   components/      page sections (status, access banner, pickers, advanced)
 *   hooks.ts         Config form, credential and state-route bindings
 *   model.ts         pure draft/diff/validation/filter helpers
 *   api.ts           state route and credential Remote helpers
 *   styles.ts        theme-token stylesheet
 */
import { CONFIG_NAMESPACE, PACKAGE_NAME } from '../shared/protocol.ts';
import { SettingsPage } from './components/SettingsPage.tsx';
import { insertStyles } from './styles.ts';
import type { ClientContext, ClientRemote, ConfigForms, SlotProps, SlotRegistry } from './types.ts';

export const inject = ['slots', 'configForms', 'remote', 'remote.credentials'];

export function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots') as SlotRegistry | undefined;
  const forms = ctx.get('configForms') as ConfigForms | undefined;
  const remote = ctx.get('remote') as ClientRemote | undefined;
  if (!slots || !forms) return;
  ctx.effect(() => insertStyles(), 'wecom-bot: styles');
  // The bundle homepage (not a plugin row) hosts the whole configuration.
  ctx.effect(() => forms.whileServed([CONFIG_NAMESPACE], () => slots.inject('plugins.bundle.config', () => slots.register(
    { name: 'plugins.bundle.config', key: PACKAGE_NAME },
    ({ view }: SlotProps) => (view === 'page' ? <SettingsPage scope={forms.get(CONFIG_NAMESPACE)} remote={remote} /> : null),
  ))), 'wecom-bot: plugin homepage');
}
