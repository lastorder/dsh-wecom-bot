// Renders the built browser bundle with real React through react-test-renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const React = require('react');
const jsxRuntime = require('react/jsx-runtime');
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8');
const h = React.createElement;

// Minimal stand-ins for the DSH Web shell primitives.
const primitives = new Proxy({
  Button: ({ variant, size, icon, children, ...rest }) => h('button', { ...rest, 'data-variant': variant }, icon, children),
  Input: ({ icon, ...rest }) => h('input', rest),
  Switch: ({ checked, onChange, label, disabled }) => h('button', { role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled, onClick: () => onChange(!checked) }),
  Tag: ({ tone, children }) => h('span', { 'data-tone': tone }, children),
  StateDot: ({ state }) => h('i', { 'data-state': state }),
  writeClipboard: async () => true,
}, { get: (target, key) => target[key] ?? (() => null) });

const STATE = {
  version: 2,
  connection: { phase: 'online', since: Date.now() - 60_000 },
  traffic: { since: 0, received: 3, rejected: 1, prompts: 1, notifications: 2, failures: 0 },
  observed: {
    users: [
      { id: 'mallory', firstSeenAt: 1, lastSeenAt: Date.now(), messages: 1, decision: 'rejected', reason: 'user', via: 'mallory' },
      { id: 'alice', firstSeenAt: 1, lastSeenAt: Date.now(), messages: 2, decision: 'accepted', via: 'alice' },
    ],
    chats: [{ id: 'alice', firstSeenAt: 1, lastSeenAt: Date.now(), messages: 2, decision: 'accepted', chatType: 'single' }],
  },
  sessions: {
    groups: [
      { key: 'w1', kind: 'workspace', title: 'dsh-wecom-bot', path: '/Users/me/dsh-wecom-bot', sessions: [
        { sessionId: 'session-aaaa', title: '企业微信插件开发', running: true, pinned: true, updatedAt: Date.now(), model: { provider: 'deepseek-account', model: 'deepseek-chat' } },
        { sessionId: 'session-bbbb', title: null, running: false, pinned: false, updatedAt: Date.now() - 3_600_000 },
      ] },
      { key: 'ungrouped', kind: 'ungrouped', title: '未分组', sessions: [
        { sessionId: 'session-cccc', title: '零散任务', running: false, pinned: false, updatedAt: 1 },
      ] },
    ],
    total: 3, archived: 4, generatedAt: Date.now(), hiddenSelections: [],
  },
  bindings: {
    total: 2,
    full: false,
    items: [
      {
        key: 'user:alice', kind: 'user', id: 'alice', admin: false,
        workspace: '', workspaceTitle: '企业微信', workspacePath: '/Users/me/.dsh/wecom-bot/workspace',
        sessionId: 'session-aaaa', sessionTitle: '企业微信插件开发', sessionState: 'bound', sessionRunning: true,
        provider: '', model: '', effectiveProvider: 'deepseek-account', effectiveModel: 'deepseek-chat',
        sessionModel: { provider: 'deepseek-account', model: 'deepseek-chat' },
        messages: 2, lastSeenAt: Date.now(), createdAt: 1, updatedAt: 2,
      },
      {
        key: 'group:wrOgAAAA', kind: 'group', id: 'wrOgAAAA', admin: false,
        workspace: '/Users/me/dsh-wecom-bot', workspaceTitle: 'dsh-wecom-bot', workspacePath: '/Users/me/dsh-wecom-bot',
        sessionId: '', sessionTitle: null, sessionState: 'auto', sessionRunning: false,
        provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'high',
        effectiveProvider: 'deepseek-account', effectiveModel: 'deepseek-reasoner',
        messages: 0, createdAt: 1, updatedAt: 2,
      },
    ],
  },
  models: {
    choices: [
      { provider: 'deepseek-account', providerName: 'DeepSeek', model: 'deepseek-chat', name: 'DeepSeek Chat' },
      { provider: 'deepseek-account', providerName: 'DeepSeek', model: 'deepseek-reasoner', name: 'DeepSeek Reasoner', efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'high' },
    ],
    dshDefault: { provider: 'deepseek-account', model: 'deepseek-chat' },
    failures: [], fetchedAt: Date.now(),
  },
  workspaces: [
    { id: 'w1', path: '/Users/me/dsh-wecom-bot', title: 'dsh-wecom-bot', pluginOwned: false, sessionCount: 2 },
  ],
  defaults: {
    workspace: '', workspacePath: '/Users/me/.dsh/wecom-bot/workspace', workspaceTitle: '企业微信',
    provider: '', model: '',
  },
  admins: ['alice'],
  adminWorkspaces: [],
  notices: [],
  journal: { enabled: true, directory: '/Users/me/.dsh/wecom-bot/logs', file: '/Users/me/.dsh/wecom-bot/logs/2026-10-16.jsonl', retentionDays: 14 },
};

function mount({ stored = {}, secretConfigured = true, state = STATE } = {}) {
  let entry;
  const fetches = [];
  const intervals = [];
  const style = [];
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { entry = value; } } },
    document: {
      visibilityState: 'visible',
      head: { appendChild(node) { style.push(node); } },
      createElement: () => ({ setAttribute() {}, remove() { style.pop(); }, textContent: '' }),
    },
    async fetch(url, options) {
      fetches.push({ url, options });
      const body = options?.method === 'POST' ? { ok: true, bindings: state.bindings } : state;
      return { ok: true, status: 200, json: async () => body };
    },
    setInterval(fn) { intervals.push(fn); return intervals.length; },
    clearInterval() {},
    setTimeout, clearTimeout, AbortController, URL, console,
  };
  vm.runInNewContext(source, sandbox);
  // The bundle's code runs inside the vm, but its globals must reach React's realm too.
  Object.assign(globalThis, { document: sandbox.document, fetch: sandbox.fetch });
  const modules = { react: React, 'react/jsx-runtime': jsxRuntime, '@deepseek-ai/dsh-client-ui-primitives': primitives };
  const plugin = entry.factory(name => {
    if (!(name in modules)) throw new Error(`unexpected require ${name}`);
    return modules[name];
  });

  let snapshot = {
    status: 'ready', revision: 1, writable: true,
    value: { botId: '', chatIds: [], allowedUserIds: [], ...stored },
  };
  const listeners = new Set();
  const mutations = [];
  const scope = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async mutate(ops, revision) {
      mutations.push({ ops, revision });
      const value = { ...snapshot.value };
      for (const op of ops) value[op.path[0]] = op.value;
      snapshot = { ...snapshot, revision: snapshot.revision + 1, value };
      for (const listener of listeners) listener();
      return true;
    },
  };
  const credentialWrites = [];
  const remote = {
    credentials: {
      async describe(refs) { return { ok: true, value: Object.fromEntries(refs.map(ref => [ref, { configured: secretConfigured, writable: true }])) }; },
      async set(ref, value) { credentialWrites.push({ ref, value }); secretConfigured = true; },
    },
  };
  let registration;
  const effects = [];
  plugin.apply({
    get: name => ({
      slots: {
        inject(key, fn) { assert.equal(key, 'plugins.bundle.config'); return fn(); },
        register(options, component) { registration = { options, component }; return () => {}; },
      },
      configForms: {
        get(ns) { assert.equal(ns, 'wecom-bot'); return scope; },
        whileServed(ns, fn) { assert.deepEqual([...ns], ['wecom-bot']); return fn(); },
      },
      remote,
    })[name],
    effect(fn) { effects.push(fn()); },
  });
  return { entry, plugin, registration, mutations, credentialWrites, fetches, style, intervals };
}

async function render(harness) {
  const element = harness.registration.component({ view: 'page' });
  let renderer;
  await act(async () => { renderer = TestRenderer.create(element); });
  await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
  return renderer;
}

const text = node => (typeof node === 'string' ? node : (node.children ?? []).map(text).join(''));
const byLabel = (root, label) => root.find(node => (node.type === 'input' || node.type === 'select') && node.props['aria-label'] === label);
const buttonWithText = (root, label) => root.find(node => node.type === 'button' && text(node).includes(label));
const flush = async () => { await act(async () => { await new Promise(resolve => setImmediate(resolve)); }); };

test('registers on the bundle homepage slot with the static module format', () => {
  const harness = mount();
  assert.equal(harness.entry.id, 'dsh-wecom-bot');
  assert.deepEqual([...harness.plugin.inject], ['slots', 'configForms', 'remote', 'remote.credentials']);
  assert.deepEqual({ ...harness.registration.options }, { name: 'plugins.bundle.config', key: 'dsh-wecom-bot' });
  assert.equal(harness.registration.component({ view: 'summary' }), null);
  assert.equal(harness.style.length, 1, 'stylesheet inserted once');
});

test('the page renders the Workspace, bindings, access and admin sections from the state route', async () => {
  const harness = mount();
  const renderer = await render(harness);
  const root = renderer.root;
  assert.ok(harness.fetches.some(call => call.url === 'api/wecom-bot/state?refresh=1'));
  const all = text(renderer.toJSON());
  assert.ok(all.includes('默认 Workspace 与模型'));
  assert.ok(all.includes('会话绑定'));
  assert.ok(all.includes('管理员'));
  assert.ok(all.includes('访问范围'));
  assert.ok(all.includes('alice'), 'the private binding id is listed');
  assert.ok(all.includes('wrOgAAAA'), 'the group binding id is listed');
  assert.ok(all.includes('企业微信插件开发'), 'the bound Session title is shown');
  assert.ok(all.includes('dsh-wecom-bot'), 'the Workspace group title is shown');
  assert.ok(byLabel(root, 'alice 的会话'));
  assert.ok(byLabel(root, 'wrOgAAAA 的模型'));
  assert.ok(byLabel(root, '默认 Workspace'));
  assert.ok(byLabel(root, '默认模型'));
  assert.ok(byLabel(root, '管理员接收 dsh-wecom-bot 的通知'));
  // Both access lists are empty in the stored config: the open-risk alert shows.
  assert.ok(all.includes('安全风险：尚未设置任何访问范围'));
  assert.ok(all.includes('1 位管理员可以切换会话'));
  renderer.unmount();
});

test('only Bot ID and Secret are required; nothing is saved until they are present', async () => {
  const harness = mount({ stored: { allowedUserIds: [] }, secretConfigured: false });
  const renderer = await render(harness);
  const root = renderer.root;
  await act(async () => { byLabel(root, '允许用户 mallory').props.onChange({ target: { checked: true } }); });
  await act(async () => { buttonWithText(root, '保存配置').props.onClick(); });
  assert.equal(harness.mutations.length, 0);
  assert.ok(text(renderer.toJSON()).includes('请填写企业微信 Bot ID'));
  assert.ok(text(renderer.toJSON()).includes('首次配置需要填写 Bot Secret'));
  await act(async () => { byLabel(root, 'Bot ID').props.onChange({ target: { value: 'aib-123' } }); });
  await act(async () => { byLabel(root, 'Bot Secret').props.onChange({ target: { value: 's3cr3t' } }); });
  await act(async () => { await buttonWithText(root, '保存配置').props.onClick(); });
  await flush();
  assert.equal(harness.mutations.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.mutations[0].ops)), [
    { op: 'set', path: ['botId'], value: 'aib-123' },
    { op: 'set', path: ['allowedUserIds'], value: ['mallory'] },
  ]);
  assert.equal(JSON.stringify(harness.mutations).includes('s3cr3t'), false, 'the Secret never enters Config');
  assert.deepEqual(harness.credentialWrites, [{ ref: 'WECOM_BOT_SECRET', value: 's3cr3t' }]);
  renderer.unmount();
});

test('the default model and admin Workspace scope save as Config fields', async () => {
  const harness = mount({ stored: { botId: 'bot' } });
  const renderer = await render(harness);
  const root = renderer.root;
  await act(async () => {
    byLabel(root, '默认模型').props.onChange({ target: { value: 'deepseek-account\u0000deepseek-reasoner' } });
  });
  await act(async () => { byLabel(root, '管理员接收 dsh-wecom-bot 的通知').props.onChange({ target: { checked: true } }); });
  await flush();
  await act(async () => { await buttonWithText(root, '保存配置').props.onClick(); });
  const ops = JSON.parse(JSON.stringify(harness.mutations[0].ops));
  assert.equal(ops.find(op => op.path[0] === 'defaultProvider').value, 'deepseek-account');
  assert.equal(ops.find(op => op.path[0] === 'defaultModel').value, 'deepseek-reasoner');
  assert.deepEqual(ops.find(op => op.path[0] === 'adminWorkspaces').value, ['/Users/me/dsh-wecom-bot']);
  renderer.unmount();
});

test('binding edits are posted immediately, without touching the Config form', async () => {
  const harness = mount({ stored: { botId: 'bot' } });
  const renderer = await render(harness);
  const root = renderer.root;
  await act(async () => {
    byLabel(root, 'alice 的模型').props.onChange({ target: { value: 'deepseek-account\u0000deepseek-reasoner' } });
  });
  await flush();
  const post = harness.fetches.find(call => call.options?.method === 'POST');
  assert.ok(post, 'the edit reached the Host');
  assert.equal(post.url, 'api/wecom-bot/bindings');
  assert.deepEqual(JSON.parse(post.options.body), {
    ops: [{ op: 'set', key: 'user:alice', patch: { provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: '' } }],
  });
  assert.equal(harness.mutations.length, 0, 'bindings never go through the Config form');
  assert.ok(text(renderer.toJSON()).includes('模型已生效'));

  // Switching the Workspace also drops the Session that belonged to the old one.
  await act(async () => {
    byLabel(root, 'alice 的 Workspace').props.onChange({ target: { value: '/Users/me/dsh-wecom-bot' } });
  });
  await flush();
  const last = harness.fetches.filter(call => call.options?.method === 'POST').at(-1);
  assert.deepEqual(JSON.parse(last.options.body).ops, [
    { op: 'set', key: 'user:alice', patch: { workspace: '/Users/me/dsh-wecom-bot' } },
    { op: 'set', key: 'user:alice', patch: { sessionId: '' } },
  ]);
  renderer.unmount();
});

test('deleting a binding asks once, then posts the delete op', async () => {
  const harness = mount({ stored: { botId: 'bot' } });
  const renderer = await render(harness);
  const root = renderer.root;
  const row = root.findAll(node => node.props?.className === 'wcb-binding')
    .find(node => text(node).includes('alice'));
  assert.ok(row, 'the private binding row is rendered');
  const deletes = row.findAll(node => node.type === 'button' && text(node) === '删除');
  assert.equal(deletes.length, 1);
  await act(async () => { deletes[0].props.onClick(); });
  await act(async () => { await buttonWithText(root, '确认删除').props.onClick(); });
  await flush();
  const post = harness.fetches.filter(call => call.options?.method === 'POST').at(-1);
  assert.deepEqual(JSON.parse(post.options.body).ops, [{ op: 'delete', key: 'user:alice' }]);
  renderer.unmount();
});

test('notice banners and a failing Workspace are surfaced on the page', async () => {
  const state = {
    ...STATE,
    notices: ['已配置管理员但未限定 Workspace：管理员会收到所有 Workspace 的会话通知。'],
    defaults: { ...STATE.defaults, workspaceError: 'Workspace 目录不存在或不是目录：/nope' },
  };
  const harness = mount({ state });
  const renderer = await render(harness);
  const all = text(renderer.toJSON());
  assert.ok(all.includes('管理员会收到所有 Workspace 的会话通知'));
  assert.ok(all.includes('Workspace 目录不存在或不是目录：/nope'));
  renderer.unmount();
});
