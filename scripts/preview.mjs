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
// A separate shot of the person dialog: the badge is the only way in, and the
// dialog is where the note and the group move live.
const dialog = process.argv.includes('--dialog');
// The two dialogs this revision introduced: the administrator picker, and the
// confirmation that archives a member's Session.
const picker = process.argv.includes('--picker');
const archive = process.argv.includes('--archive');
const read = path => readFile(resolve(root, path), 'utf8');

const now = Date.now();
const REPO = '/Users/me/Workspace/learn/dsh-wecom-bot';
const PLUGIN_WS = '/Users/me/.dsh/wecom-bot/workspace';
const state = {
  version: '0.5',
  connection: empty ? { phase: 'unconfigured', since: now - 30_000, detail: '缺少 Bot ID' } : { phase: 'online', since: now - 25 * 60_000 },
  traffic: empty ? { since: now, received: 0, rejected: 0, prompts: 0, notifications: 0, failures: 0 }
    : { since: now - 3_600_000, received: 21, rejected: 2, prompts: 9, notifications: 11, failures: 0, lastMessageAt: now - 90_000 },
  rejected: empty ? [] : [
    {
      key: 'user:WangWu', kind: 'user', id: 'WangWu', chatType: 'single',
      label: '', displayName: 'WangWu',
      text: '帮我看下这个仓库的登录问题，谢谢！', messages: 3,
      firstSeenAt: now - 1_800_000, lastSeenAt: now - 240_000,
    },
    {
      key: 'group:wrOgCCCCCCCCstrangers', kind: 'group', id: 'wrOgCCCCCCCCstrangers', chatType: 'group',
      label: '外部合作群', displayName: '外部合作群',
      text: '@机器人 明天上午十点的评审在哪个会议室？', messages: 1,
      firstSeenAt: now - 900_000, lastSeenAt: now - 900_000,
    },
  ],
  sessions: {
    groups: [
      { key: 'w1', kind: 'workspace', title: 'dsh-wecom-bot', path: REPO, sessions: [
        { sessionId: '0dd82b7f-516c-41dc-b0a0-ac95e596a05a', title: '企业微信 Bot 插件开发', running: true, pinned: true, updatedAt: now - 60_000, model: { provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'high' }, preset: 'standard', context: { used: 128_000, window: 128_000 } },
        { sessionId: 'fa761602-210c-4653-8dc6-9d74e1f71507', title: '配置页重构与日志', running: false, pinned: false, updatedAt: now - 3 * 3_600_000, model: { provider: 'deepseek-account', model: 'deepseek-chat' }, preset: 'minimal' },
        { sessionId: '8e05784f-03c2-41a7-b675-7a60b64efa01', title: null, running: false, pinned: false, updatedAt: now - 2 * 86_400_000 },
      ] },
      { key: 'w3', kind: 'workspace', title: '企业微信', path: PLUGIN_WS, sessions: [
        { sessionId: '934bf135-e3e5-4c8e-9784-45ddc1457c05', title: '周报整理', running: false, pinned: false, updatedAt: now - 5 * 86_400_000, model: { provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'high' }, preset: 'standard', context: { used: 12_300, window: 128_000 } },
        { sessionId: '5b19e0f2-6d3a-4a1e-9d3f-1a2b3c4d5e6f', title: '群里的运维问答', running: true, pinned: false, updatedAt: now - 2 * 86_400_000, model: { provider: 'deepseek-account', model: 'deepseek-chat' }, preset: 'ptc', context: { used: 41_000, window: 128_000 } },
      ] },
      { key: 'ungrouped', kind: 'ungrouped', title: '未分组', sessions: [
        { sessionId: 'db3af9bd-edb8-4c11-8869-9e63c4174f9c', title: '临时问题', running: false, pinned: false, updatedAt: now - 9 * 86_400_000 },
      ] },
    ],
    total: 6, archived: 7, generatedAt: now - 2000,
    hiddenSelections: [],
  },
  routing: {
    total: empty ? 0 : 4,
    full: false,
    groups: [
      {
        id: 'default', name: '默认分组', isDefault: true,
        workspace: '', workspaceTitle: '企业微信', workspacePath: PLUGIN_WS,
        // No model of its own: the header says it follows the DSH default.
        provider: '', model: '', effectiveProvider: '', effectiveModel: '', preset: '',
        memberCount: empty ? 0 : 3, messages: empty ? 0 : 20, lastSeenAt: now - 90_000,
        members: empty ? [] : [
          {
            key: 'user:ZhangSan', kind: 'user', id: 'ZhangSan', label: '张三', displayName: '张三', admin: true,
            sessionId: '934bf135-e3e5-4c8e-9784-45ddc1457c05', sessionTitle: '周报整理',
            sessionState: 'bound', sessionRunning: false,
            sessionModel: { provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'high' },
            sessionPreset: 'standard', sessionContext: { used: 12_300, window: 128_000 },
            messages: 14, lastSeenAt: now - 90_000, createdAt: now - 3_600_000,
          },
          {
            key: 'user:LiSi', kind: 'user', id: 'LiSi', label: '', displayName: 'LiSi', admin: false,
            sessionId: '', sessionTitle: null, sessionState: 'auto', sessionRunning: false,
            messages: 2, lastSeenAt: now - 600_000, createdAt: now - 1_800_000,
          },
          {
            key: 'group:wrOgAAAAAAAAexample', kind: 'group', id: 'wrOgAAAAAAAAexample', label: '', displayName: 'wrOgAAAAAAAAexample', admin: false,
            sessionId: '5b19e0f2-6d3a-4a1e-9d3f-1a2b3c4d5e6f', sessionTitle: '群里的运维问答',
            sessionState: 'bound', sessionRunning: true,
            sessionModel: { provider: 'deepseek-account', model: 'deepseek-chat' },
            sessionPreset: 'ptc', sessionContext: { used: 41_000, window: 128_000 },
            messages: 4, lastSeenAt: now - 600_000, createdAt: now - 1_800_000,
          },
        ],
      },
      {
        id: 'g1', name: '同事', isDefault: false,
        workspace: REPO, workspaceTitle: 'dsh-wecom-bot', workspacePath: REPO,
        provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'high', preset: 'ptc',
        effectiveProvider: 'deepseek-account', effectiveModel: 'deepseek-reasoner', effectiveReasoningEffort: 'high',
        memberCount: empty ? 0 : 1, messages: 0,
        members: empty ? [] : [
          {
            key: 'group:wrOgBBBBBBBBother', kind: 'group', id: 'wrOgBBBBBBBBother', label: '研发群', displayName: '研发群', admin: false,
            sessionId: '0dd82b7f-516c-41dc-b0a0-ac95e596a05a', sessionTitle: '企业微信 Bot 插件开发',
            sessionState: 'bound', sessionRunning: true,
            sessionModel: { provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'high' },
            sessionPreset: 'standard', sessionContext: { used: 61_500, window: 128_000 },
            messages: 6, lastSeenAt: now - 3 * 3_600_000, createdAt: now - 86_400_000,
          },
        ],
      },
    ],
  },
  models: {
    choices: [
      { provider: 'deepseek-account', providerName: 'DeepSeek', model: 'deepseek-chat', name: 'DeepSeek Chat' },
      { provider: 'deepseek-account', providerName: 'DeepSeek', model: 'deepseek-reasoner', name: 'DeepSeek Reasoner', efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'high' },
      { provider: 'pi-ai', providerName: 'Pi AI', model: 'gpt-5', name: 'GPT-5' },
    ],
    dshDefault: { provider: 'deepseek-account', model: 'deepseek-chat' },
    failures: [], fetchedAt: now - 12_000,
  },
  presets: {
    presets: [
      { id: 'standard', isDefault: true },
      { id: 'ptc' },
      { id: 'minimal' },
      { id: 'cordis' },
    ],
    fetchedAt: now - 12_000,
  },
  workspaces: [
    { id: 'w1', path: REPO, title: 'dsh-wecom-bot', pluginOwned: false, sessionCount: 3, archivedSessionCount: 4 },
    { id: 'w3', path: PLUGIN_WS, title: '企业微信', pluginOwned: true, sessionCount: 2, archivedSessionCount: 7 },
    // Every Session archived: it can never notify anybody, but the list still
    // shows it so the operator can see the whole Workspace set.
    { id: 'w9', path: '/Users/me/Workspace/orion-agent', title: 'orion-agent', pluginOwned: false, sessionCount: 0, archivedSessionCount: 32 },
  ],
  admins: empty ? [] : [{ id: 'ZhangSan', label: '张三', displayName: '张三', groupName: '默认分组' }],
  // The store's settings block; the ④ and ⑤ cards read it from here. An empty
  // `adminWorkspaces` is the documented default: every Workspace, every box checked.
  settings: empty
    ? {
      wsUrl: '', adminUserIds: [], adminWorkspaces: [], questionTimeoutMs: 60000,
      remoteApprovals: false, logEnabled: true, logRetentionDays: 14,
    }
    : {
      wsUrl: '', adminUserIds: ['ZhangSan'], adminWorkspaces: [], questionTimeoutMs: 30000,
      remoteApprovals: true, logEnabled: true, logRetentionDays: 14,
    },
  notices: [],
  journal: { enabled: true, directory: '/Users/me/.dsh/wecom-bot/logs', file: '/Users/me/.dsh/wecom-bot/logs/2026-10-16.jsonl', retentionDays: 14 },
};
// A fresh install has the built-in group only.
if (empty) state.routing.groups = state.routing.groups.filter(group => group.isDefault);
// The Config the ①连接 card edits: the connection identity, nothing else.
const stored = empty ? { botId: '' } : { botId: 'aibAbCdEfGh123456' };

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
.p-modal{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:24px}
.p-modal-mask{position:absolute;inset:0;background:#0008;backdrop-filter:blur(2px)}
.p-modal-card{position:relative;width:min(560px,100%);max-height:80vh;overflow:auto;padding:20px 22px;border-radius:16px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);box-shadow:0 24px 60px #0005;font-family:inherit}
.p-modal-head{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.p-modal-title{flex:1;font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary)}
.p-modal-close{border:none;background:none;cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:1;padding:2px 4px}
.p-modal-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
`;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>WeCom Bot settings preview</title>
<style>body{${tokens}margin:0;padding:28px;background:var(--dsw-alias-bg-base);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif}${PRIMITIVES_CSS}</style>
<script>${await read('node_modules/react/umd/react.development.js')}</script>
<script>${await read('node_modules/react-dom/umd/react-dom.development.js')}</script>
</head><body><div id="root"></div>
<script>
// A failed render must be visible in the screenshot instead of a blank page.
window.addEventListener('error', event => {
  const detail = (event.error && event.error.stack) || event.message || 'unknown error';
  document.body.insertAdjacentHTML('afterbegin', '<pre style="color:#c00;padding:16px;white-space:pre-wrap">' + detail + '</pre>');
});
</script>
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
  IconTrashOutlineRegular: icon('M2.5 4.5h11M6 4.5V2.5h4v2M4 4.5l.8 9h6.4l.8-9M6.5 7v4M9.5 7v4'),
  IconPlusOutlineRegular: icon('M8 2.5v11M2.5 8h11'),
  IconEditOutlineRegular: icon('M2.5 13.5h2.5L13 5.5 10.5 3 2.5 11v2.5ZM9.5 4l2.5 2.5'),
  IconAgentPresetOutlineRegular: icon('M8 1.5 9.7 6.3 14.5 8 9.7 9.7 8 14.5 6.3 9.7 1.5 8 6.3 6.3Z'),
};
const primitives = {
  ...icons,
  Button: ({ variant = 'ghost', size = 'md', icon, className, children, ...rest }) => h('button', { type: 'button', ...rest, className: ['p-btn', variant, size, className].join(' ') }, icon, children),
  Input: ({ icon, className, ...rest }) => h('span', { className: 'p-input ' + (className || '') }, icon && h('span', { className: 'ic' }, icon), h('input', rest)),
  Switch: ({ checked, onChange, label, disabled }) => h('button', { type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled, className: 'p-switch', onClick: () => onChange(!checked) }, h('span')),
  Tag: ({ tone = 'outline', children }) => h('span', { className: 'p-tag', 'data-tone': tone }, children),
  StateDot: ({ state, size }) => h('span', { className: 'p-dot', 'data-state': state, style: { width: size || (state === 'ongoing' ? 12 : 8), height: size || (state === 'ongoing' ? 12 : 8) } }),
  // The real Modal portals to document.body; so does this one, with the same
  // mask/dialog/head/body/footer shape the shell's CSS module produces.
  Modal: ({ open, onClose, title, closeLabel, children, footer, className }) => (open
    ? ReactDOM.createPortal(
      h('div', { className: 'p-modal' },
        h('div', { className: 'p-modal-mask', onClick: onClose }),
        h('div', { className: ['p-modal-card', className || ''].join(' '), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('div', { className: 'p-modal-head' },
            h('span', { className: 'p-modal-title' }, title),
            h('button', { type: 'button', className: 'p-modal-close', 'aria-label': closeLabel, onClick: onClose }, '×')),
          h('div', { className: 'p-modal-body' }, children),
          footer && h('div', { className: 'p-modal-foot' }, footer))),
      document.body)
    : null),
  writeClipboard: async () => true,
};
const modules = { react: React, 'react/jsx-runtime': runtime, '@deepseek-ai/dsh-client-ui-primitives': primitives };
let entry;
window.__ModuleLoader__ = { load(value) { entry = value; } };
window.fetch = async (url, options) => {
  const body = options && options.method === 'POST' ? { ok: true, routing: STATE.routing } : STATE;
  return { ok: true, status: 200, json: async () => body };
};
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
// The page opens with every group folded, so the preview expands the first one
// and presses its 编辑 button, which is what reveals the group settings.
if (!${empty}) setTimeout(() => { document.querySelectorAll('.wcb-group-toggle')[0]?.click(); }, 200);
// The dialog shot keeps the group folded back to its member list: the point is
// the person, not the group form.
if (!${empty} && !${dialog} && !${archive} && !${picker}) setTimeout(() => { document.querySelector('[aria-label="编辑 默认分组"]')?.click(); }, 350);
// The --dialog variant goes one step further: the badge opens the person
// details, which is where the 备注 and the group move live.
if (${dialog}) setTimeout(() => { document.querySelector('[aria-label="张三 的详情"]')?.click(); }, 500);
if (${archive}) setTimeout(() => { document.querySelector('[aria-label="归档 张三 的会话"]')?.click(); }, 500);
if (${picker}) setTimeout(() => { document.querySelector('[aria-label="添加管理员"]')?.click(); }, 500);
if (${advanced}) setTimeout(() => {
  document.querySelector('details').open = true;
  // Also open the notification scope, so the variant shows which Workspaces it
  // offers after archived Sessions are left out.
  [...document.querySelectorAll('.wcb-group-toggle')]
    .find(toggle => toggle.textContent.includes('可接收通知的 Workspace'))?.click();
}, 300);
// Report the rendered height so the screenshot can be cut to the page instead
// of a guessed window size (which left a band of empty background).
setTimeout(() => { document.title = 'H=' + Math.ceil(document.documentElement.scrollHeight); }, 1400);
</script></body></html>`;

await mkdir(out, { recursive: true });
const file = resolve(out, 'index.html');
await writeFile(file, html);
console.log(file);

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (existsSync(chrome)) {
  const png = resolve(out, `settings${dark ? '-dark' : ''}${empty ? '-empty' : ''}${advanced ? '-advanced' : ''}${dialog ? '-dialog' : ''}${picker ? '-picker' : ''}${archive ? '-archive' : ''}.png`);
  const flags = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=3000'];
  // Measure at the real width first (the page has a <820px breakpoint), then
  // screenshot exactly that tall, so the PNG has no empty band at the bottom.
  let height = 1600;
  try {
    const dom = execFileSync(chrome, [...flags, '--window-size=1100,1200', '--dump-dom', pathToFileURL(file).href],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const measured = Number(/<title>H=(\d+)<\/title>/.exec(dom)?.[1]);
    if (Number.isFinite(measured) && measured > 400) height = measured;
  } catch { /* a fixed window is still a usable screenshot */ }
  execFileSync(chrome, [...flags, `--window-size=1100,${height}`, `--screenshot=${png}`, pathToFileURL(file).href], { stdio: 'ignore' });
  console.log(`${png} (1100x${height})`);
}
