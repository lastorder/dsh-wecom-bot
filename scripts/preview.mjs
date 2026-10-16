// Render the built settings page in a standalone HTML file with sample data,
// DSH theme tokens and look-alike primitives, then (if Chrome is installed)
// screenshot it:  node scripts/preview.mjs [--dark] [--empty]
// Output: preview/index.html and preview/settings[-dark|-empty].png
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'preview');
const dark = process.argv.includes('--dark');
const empty = process.argv.includes('--empty');
const advanced = process.argv.includes('--advanced');
const read = path => readFile(resolve(root, path), 'utf8');

const now = Date.now();
const state = {
  version: 1,
  connection: empty ? { phase: 'unconfigured', since: now - 30_000, detail: '缺少 Bot ID' } : { phase: 'online', since: now - 25 * 60_000 },
  traffic: empty ? { since: now, received: 0, rejected: 0, prompts: 0, notifications: 0, failures: 0 }
    : { since: now - 3_600_000, received: 18, rejected: 2, prompts: 9, notifications: 11, failures: 0, lastMessageAt: now - 90_000 },
  observed: empty ? { users: [], chats: [] } : {
    users: [
      { id: 'ZhangSan', firstSeenAt: now - 3_600_000, lastSeenAt: now - 90_000, messages: 14, decision: 'accepted', via: 'ZhangSan' },
      { id: 'LiSi', firstSeenAt: now - 1_800_000, lastSeenAt: now - 600_000, messages: 2, decision: 'rejected', reason: 'user', via: 'wrOgAAAAAAAAexample' },
    ],
    chats: [
      { id: 'ZhangSan', firstSeenAt: now - 3_600_000, lastSeenAt: now - 90_000, messages: 12, decision: 'accepted', chatType: 'single' },
      { id: 'wrOgAAAAAAAAexample', firstSeenAt: now - 1_800_000, lastSeenAt: now - 600_000, messages: 4, decision: 'rejected', reason: 'user', chatType: 'group', via: 'LiSi' },
    ],
  },
  sessions: {
    groups: [
      { key: 'w1', kind: 'workspace', title: 'dsh-wecom-bot', path: '/Users/me/Workspace/learn/dsh-wecom-bot', sessions: [
        { sessionId: '0dd82b7f-516c-41dc-b0a0-ac95e596a05a', title: '企业微信 Bot 插件开发', running: true, pinned: true, updatedAt: now - 60_000 },
        { sessionId: 'fa761602-210c-4653-8dc6-9d74e1f71507', title: '配置页重构与日志', running: false, pinned: false, updatedAt: now - 3 * 3_600_000 },
        { sessionId: '8e05784f-03c2-41a7-b675-7a60b64efa01', title: null, running: false, pinned: false, updatedAt: now - 2 * 86_400_000 },
      ] },
      { key: 'w2', kind: 'workspace', title: 'dsh-mattermost', path: '/Users/me/Workspace/learn/dsh-mattermost', sessions: [
        { sessionId: 'c5a3f106-dd91-49a8-bd42-4d9fca1b60f8', title: 'Mattermost 通知桥', running: false, pinned: false, updatedAt: now - 86_400_000 },
      ] },
      { key: 'w3', kind: 'workspace', title: '默认工作区', path: '/Users/me/Documents/deepseek-harness/default-workspace', sessions: [
        { sessionId: '934bf135-e3e5-4c8e-9784-45ddc1457c05', title: '周报整理', running: false, pinned: false, updatedAt: now - 5 * 86_400_000 },
      ] },
      { key: 'ungrouped', kind: 'ungrouped', title: '未分组', sessions: [
        { sessionId: 'db3af9bd-edb8-4c11-8869-9e63c4174f9c', title: '临时问题', running: false, pinned: false, updatedAt: now - 9 * 86_400_000 },
      ] },
    ],
    total: 6, archived: 7, generatedAt: now - 2000,
    hiddenSelections: empty ? [] : [{ sessionId: '71d26f38-0650-4a43-967d-13388b83ab61', title: '旧的测试会话', reason: 'archived' }],
  },
  journal: { enabled: true, directory: '/Users/me/.dsh/wecom-bot/logs', file: '/Users/me/.dsh/wecom-bot/logs/2026-10-16.jsonl', retentionDays: 14 },
};
const stored = empty
  ? { botId: '', chatIds: [], sessionIds: [], allowedUserIds: [] }
  : { botId: 'aibAbCdEfGh123456', chatIds: ['ZhangSan'], sessionIds: ['0dd82b7f-516c-41dc-b0a0-ac95e596a05a', '71d26f38-0650-4a43-967d-13388b83ab61'], allowedUserIds: [] };

// Light/dark values of the DSH tokens the page and the primitives read.
const TOKENS = {
  light: {
    'bg-base': '#fff', 'bg-layer-1': '#fff', 'bg-layer-2': '#fff', 'bg-layer-3': '#fff', 'bg-module-platform': '#f5f6f7',
    'border-l1': '#0000000a', 'border-l2': '#0000001a', 'border-l3': '#0000001f', 'border-l4': '#00000029',
    'brand-primary': '#0f1115', 'button-primary-fill': '#0f1115', 'button-primary-hover': '#43454a', 'label-primary-foreground': '#fff',
    'button-tool-bar-fill': '#ebeef2', 'button-tool-bar-hover': '#e1e5ee',
    'interactive-bg-hover': '#2631480f', 'interactive-bg-active': '#2631481a',
    'label-primary': '#0f1115', 'label-secondary': '#61666b', 'label-tertiary': '#81858c', 'label-dimmed': '#e1e5ee',
    'state-business-primary': '#4176e6', 'state-error-primary': '#ec1313', 'state-success-primary': '#22c55e', 'state-warn-primary': '#f59e0b',
    'switch-thumb': '#fff',
  },
  dark: {
    'bg-base': '#151517', 'bg-layer-1': '#232324', 'bg-layer-2': '#2c2c2e', 'bg-layer-3': '#353638', 'bg-module-platform': '#353638',
    'border-l1': '#ffffff0f', 'border-l2': '#ffffff1f', 'border-l3': '#ffffff29', 'border-l4': '#fff3',
    'brand-primary': '#f9fafb', 'button-primary-fill': '#f9fafb', 'button-primary-hover': '#ebeef2', 'label-primary-foreground': '#0f1115',
    'button-tool-bar-fill': '#54555780', 'button-tool-bar-hover': '#54555799',
    'interactive-bg-hover': '#ffffff14', 'interactive-bg-active': '#ffffff24',
    'label-primary': '#f9fafb', 'label-secondary': '#cfd3d6', 'label-tertiary': '#adb2b8', 'label-dimmed': '#43454a',
    'state-business-primary': '#7aaaff', 'state-error-primary': '#f25a5a', 'state-success-primary': '#22c55e', 'state-warn-primary': '#f59e0b',
    'switch-thumb': '#adb2b8',
  },
};
const tokens = Object.entries(TOKENS[dark ? 'dark' : 'light']).map(([key, value]) => `--dsw-alias-${key}:${value};`).join('');

const PRIMITIVES_CSS = `
.p-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:none;border-radius:8px;cursor:pointer;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);background:transparent;padding:0 14px;height:36px;font-family:inherit}
.p-btn:disabled{cursor:not-allowed;opacity:.4}.p-btn.sm{height:28px;font-size:12px;line-height:18px;padding:0 10px;border-radius:6px}
.p-btn.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.p-btn.ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.p-btn.outline{border:.5px solid var(--dsw-alias-border-l3)}.p-btn.toolbar{background:var(--dsw-alias-button-tool-bar-fill)}
.p-input{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.p-input:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.p-input input{flex:1;min-width:0;border:none;outline:none;background:transparent;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);font-family:inherit}
.p-input .ic{color:var(--dsw-alias-label-tertiary);display:inline-flex}
.p-tag{display:inline-flex;align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap}
.p-tag[data-tone=outline]{border:.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-tertiary)}
.p-tag[data-tone=quiet]{color:var(--dsw-alias-label-tertiary)}
.p-tag[data-tone=success]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}
.p-tag[data-tone=info]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}
.p-tag[data-tone=warning]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary)}
.p-tag[data-tone=danger]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.p-switch{position:relative;width:36px;height:20px;border-radius:999px;border:none;background:var(--dsw-alias-border-l4);cursor:pointer;padding:0;flex:none}
.p-switch[aria-checked=true]{background:var(--dsw-alias-button-primary-fill)}
.p-switch span{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb);transition:left .15s}
.p-switch[aria-checked=true] span{left:18px;background:var(--dsw-alias-label-primary-foreground)}
.p-dot{display:inline-block;border-radius:50%}.p-dot[data-state=done]{background:var(--dsw-alias-state-success-primary)}
.p-dot[data-state=warning]{background:var(--dsw-alias-state-warn-primary)}.p-dot[data-state=error]{background:var(--dsw-alias-state-error-primary)}
.p-dot[data-state=idle]{background:var(--dsw-alias-label-tertiary)}.p-dot[data-state=ongoing]{border:2px solid var(--dsw-alias-label-tertiary);border-right-color:transparent;box-sizing:border-box}
`;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>WeCom Bot settings preview</title>
<style>body{${tokens}margin:0;padding:28px;background:var(--dsw-alias-bg-base);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif}${PRIMITIVES_CSS}</style>
<script>${await read('node_modules/react/umd/react.development.js')}</script>
<script>${await read('node_modules/react-dom/umd/react-dom.development.js')}</script>
</head><body><div id="root"></div>
<script>
const STATE = ${JSON.stringify(state)};
const h = React.createElement;
const jsx = (type, props, key) => h(type, key === undefined ? props : { ...props, key });
const runtime = { jsx, jsxs: jsx, Fragment: React.Fragment };
const icon = path => ({ size = 16 }) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }, h('path', { d: path }));
const icons = {
  IconSearchOutlineRegular: icon('M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5'),
  IconRefreshOutlineRegular: icon('M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3'),
  IconChevronRightOutlineRegular: icon('M6 3.5 10.5 8 6 12.5'),
  IconFolderCloseRegular: icon('M1.5 4.5v8h13v-7H8L6.5 3.5h-5Z'),
  IconPinFillRegular: icon('M8 1.5 11 5l-1.5 1.5L12 9l-4 0-1 5-1-5H2l2.5-2.5L3 5Z'),
  IconUserOutlineRegular: icon('M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 14.5a5.5 5.5 0 0 1 11 0'),
  IconUsersOutlineRegular: icon('M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.5 13.5a4.5 4.5 0 0 1 9 0M10.5 2.8a2.5 2.5 0 0 1 0 4.4M12 9.5a4.5 4.5 0 0 1 2.5 4'),
  IconShieldOutlineRegular: icon('M8 1.5 13.5 3.5v4c0 3.5-2.5 6-5.5 7-3-1-5.5-3.5-5.5-7v-4Z'),
  IconWarningTriangleOutlineRegular: icon('M8 2 14.5 13.5h-13ZM8 6.5v3.5M8 11.8v.2'),
  IconCheckCircleOutlineRegular: icon('M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM5 8l2 2 4-4'),
  IconCopyOutlineRegular: icon('M5.5 5.5h8v8h-8ZM10.5 5.5v-3h-8v8h3'),
  IconPlusOutlineRegular: icon('M8 2.5v11M2.5 8h11'),
};
const primitives = {
  ...icons,
  Button: ({ variant = 'ghost', size = 'md', icon, className, children, ...rest }) => h('button', { type: 'button', ...rest, className: ['p-btn', variant, size, className].join(' ') }, icon, children),
  Input: ({ icon, className, ...rest }) => h('span', { className: 'p-input ' + (className || '') }, icon && h('span', { className: 'ic' }, icon), h('input', rest)),
  Switch: ({ checked, onChange, label, disabled }) => h('button', { type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled, className: 'p-switch', onClick: () => onChange(!checked) }, h('span')),
  Tag: ({ tone = 'outline', children }) => h('span', { className: 'p-tag', 'data-tone': tone }, children),
  StateDot: ({ state, size }) => h('span', { className: 'p-dot', 'data-state': state, style: { width: size || (state === 'ongoing' ? 12 : 8), height: size || (state === 'ongoing' ? 12 : 8) } }),
  writeClipboard: async () => true,
};
const modules = { react: React, 'react/jsx-runtime': runtime, '@deepseek-ai/dsh-client-ui-primitives': primitives };
let entry;
window.__ModuleLoader__ = { load(value) { entry = value; } };
window.fetch = async () => ({ ok: true, status: 200, json: async () => STATE });
</script>
<script>${await read('dist/client.js')}</script>
<script>
const plugin = entry.factory(name => modules[name]);
let snapshot = { status: 'ready', revision: 1, writable: true, value: ${JSON.stringify(stored)} };
const listeners = new Set();
const scope = {
  getSnapshot: () => snapshot,
  subscribe: l => { listeners.add(l); return () => listeners.delete(l); },
  async mutate(ops) { const value = { ...snapshot.value }; for (const op of ops) value[op.path[0]] = op.value; snapshot = { ...snapshot, revision: snapshot.revision + 1, value }; listeners.forEach(l => l()); return true; },
};
const remote = { credentials: { async describe(refs) { return Object.fromEntries(refs.map(r => [r, { configured: ${!empty} }])); }, async set() {} } };
let page;
plugin.apply({
  get: name => ({
    slots: { inject: (key, fn) => fn(), register: (options, component) => { page = component; return () => {}; } },
    configForms: { get: () => scope, whileServed: (ns, fn) => fn() },
    remote,
  })[name],
  effect: fn => fn(),
});
ReactDOM.createRoot(document.getElementById('root')).render(page({ view: 'page' }));
if (${advanced}) setTimeout(() => { document.querySelector('details').open = true; }, 300);
</script></body></html>`;

await mkdir(out, { recursive: true });
const file = resolve(out, 'index.html');
await writeFile(file, html);
console.log(file);

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (existsSync(chrome)) {
  const png = resolve(out, `settings${dark ? '-dark' : ''}${empty ? '-empty' : ''}${advanced ? '-advanced' : ''}.png`);
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--virtual-time-budget=3000', `--window-size=1100,${empty ? 1700 : advanced ? 2600 : 2000}`, `--screenshot=${png}`, pathToFileURL(file).href], { stdio: 'ignore' });
  console.log(png);
}
