/**
 * Wire contract shared by the Host plugin and the browser settings page.
 *
 * This module holds only constants and types, so both halves can import it:
 * the Host through NodeNext (`../shared/protocol.js`) and the browser bundle
 * through esbuild (`../shared/protocol.ts`).
 */
export const PACKAGE_NAME = '@local/dsh-wecom-bot';
/** Loader entry id from cordis.patch.yml; also the Config form namespace. */
export const CONFIG_NAMESPACE = 'wecom-bot';
export const DEFAULT_SECRET_REF = 'WECOM_BOT_SECRET';
/** Authenticated Connection Fetch route; the browser reads it document-relative. */
export const STATE_ROUTE = '/api/wecom-bot/state';
/** Directory below the DSH home that holds this plugin's own data. */
export const PLUGIN_HOME_DIRECTORY = 'wecom-bot';
//# sourceMappingURL=protocol.js.map