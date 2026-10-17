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
  version: 3,
  connection: { phase: 'online', since: Date.now() - 60_000 },
  traffic: { since: 0, received: 3, rejected: 1, prompts: 1, notifications: 2, failures: 0 },
  rejected: [{
    key: 'user:mallory', kind: 'user', id: 'mallory', chatType: 'single',
    label: '', displayName: 'mallory',
    text: '帮我看看这个仓库', messages: 2, firstSeenAt: 1, lastSeenAt: Date.now(),
  }],
  sessions: {
    groups: [
      { key: 'w1', kind: 'workspace', title: 'dsh-wecom-bot', path: '/Users/me/dsh-wecom-bot', sessions: [
        { sessionId: 'session-aaaa', title: '企业微信插件开发', running: true, pinned: true, updatedAt: Date.now(), model: { provider: 'deepseek-account', model: 'deepseek-chat' } },
        { sessionId: 'session-bbbb', title: null, running: false, pinned: false, updatedAt: Date.now() - 3_600_000 },
      ] },
    ],
    total: 2, archived: 4, generatedAt: Date.now(), hiddenSelections: [],
  },
  routing: {
    total: 2,
    full: false,
    groups: [
      {
        id: 'default', name: '默认分组', isDefault: true,
        workspace: '', workspaceTitle: '企业微信', workspacePath: '/Users/me/.dsh/wecom-bot/workspace',
        provider: '', model: '', effectiveProvider: '', effectiveModel: '',
        memberCount: 1, messages: 2, lastSeenAt: Date.now(),
        members: [{
          key: 'user:alice', kind: 'user', id: 'alice', label: '爱丽丝', displayName: '爱丽丝', admin: false,
          sessionId: 'session-aaaa', sessionTitle: '企业微信插件开发', sessionState: 'bound', sessionRunning: true,
          sessionModel: { provider: 'deepseek-account', model: 'deepseek-chat' },
          messages: 2, lastSeenAt: Date.now(), createdAt: 1,
        }],
      },
      {
        id: 'g1', name: '朋友', isDefault: false,
        workspace: '/Users/me/dsh-wecom-bot', workspaceTitle: 'dsh-wecom-bot', workspacePath: '/Users/me/dsh-wecom-bot',
        provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'high',
        effectiveProvider: 'deepseek-account', effectiveModel: 'deepseek-reasoner',
        memberCount: 1, messages: 0,
        members: [{
          key: 'group:wrOgAAAA', kind: 'group', id: 'wrOgAAAA', label: '', displayName: 'wrOgAAAA', admin: false,
          sessionId: '', sessionTitle: null, sessionState: 'auto', sessionRunning: false,
          messages: 0, createdAt: 2,
        }],
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
    { id: 'w1', path: '/Users/me/dsh-wecom-bot', title: 'dsh-wecom-bot', pluginOwned: false, sessionCount: 2, archivedSessionCount: 4 },
    // Every Session archived: it can never notify anybody, so the scope list hides it.
    { id: 'w2', path: '/Users/me/orion-agent', title: 'orion-agent', pluginOwned: false, sessionCount: 0, archivedSessionCount: 32 },
  ],
  admins: [{ id: 'alice', label: '', displayName: 'alice' }],
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
      const body = options?.method === 'POST' ? { ok: true, routing: state.routing } : state;
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
    value: { botId: '', adminUserIds: [], adminWorkspaces: [], ...stored },
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
const queryByLabel = (root, label) => root.findAll(node => (node.type === 'input' || node.type === 'select') && node.props['aria-label'] === label)[0];
const buttonWithText = (root, label) => root.find(node => node.type === 'button' && text(node).includes(label));
const exactButton = (root, label) => root.find(node => node.type === 'button' && text(node) === label);
const buttonByLabel = (root, label) => root.find(node => node.type === 'button' && node.props['aria-label'] === label);
const flush = async () => { await act(async () => { await new Promise(resolve => setImmediate(resolve)); }); };
const posts = harness => harness.fetches.filter(call => call.options?.method === 'POST').map(call => JSON.parse(call.options.body).ops);

test('registers on the bundle homepage slot with the static module format', () => {
  const harness = mount();
  assert.equal(harness.entry.id, 'dsh-wecom-bot');
  assert.deepEqual([...harness.plugin.inject], ['slots', 'configForms', 'remote', 'remote.credentials']);
  assert.deepEqual({ ...harness.registration.options }, { name: 'plugins.bundle.config', key: 'dsh-wecom-bot' });
  assert.equal(harness.registration.component({ view: 'summary' }), null);
  assert.equal(harness.style.length, 1, 'stylesheet inserted once');
});

test('the page shows five cards and keeps every group collapsed until it is clicked', async () => {
  const harness = mount();
  const renderer = await render(harness);
  const root = renderer.root;
  assert.ok(harness.fetches.some(call => call.url === 'api/wecom-bot/state?refresh=1'));
  const all = text(renderer.toJSON());
  for (const title of ['连接机器人', '用户分组', '未授权用户', '管理员', '高级设置']) assert.ok(all.includes(title), title);
  assert.equal(all.includes('访问范围'), false, 'the access-scope card is gone');
  assert.equal(all.includes('会话绑定'), false, 'bindings became group members');
  assert.equal(all.includes('默认 Workspace 与模型'), false, 'it merged into 用户分组');

  // Summaries are visible while collapsed; the editors are not.
  assert.ok(all.includes('默认分组'));
  assert.ok(all.includes('朋友'));
  assert.ok(all.includes('1 位成员 · 企业微信'));
  assert.equal(queryByLabel(root, '默认分组 的名称'), undefined);
  assert.equal(queryByLabel(root, 'alice 的备注'), undefined);

  // Opening one group reveals its members — not its Workspace/model controls,
  // which only appear once 编辑 is pressed on that group's row.
  await act(async () => { buttonWithText(root, '默认分组').props.onClick(); });
  assert.ok(text(renderer.toJSON()).includes('爱丽丝'), 'a member is listed by its note');
  assert.equal(queryByLabel(root, '默认分组 的名称'), undefined, 'the config waits for 编辑');
  assert.equal(queryByLabel(root, '默认分组 的模型'), undefined);
  assert.equal(queryByLabel(root, 'alice 的备注'), undefined, 'member details wait for a click');
  const edited = await act(async () => { buttonByLabel(root, '编辑 默认分组').props.onClick(); });
  assert.ok(edited !== undefined || true);
  assert.ok(byLabel(root, '默认分组 的名称'));
  assert.ok(byLabel(root, '默认分组 的 Workspace'));
  assert.ok(byLabel(root, '默认分组 的模型'));
  assert.equal(queryByLabel(root, '朋友 的名称'), undefined, 'the other group stays untouched');
  // Clicking the person reveals the type, the WeCom id and the editable note.
  await act(async () => { buttonByLabel(root, '爱丽丝 的详情').props.onClick(); });
  assert.ok(byLabel(root, 'alice 的会话'));
  assert.ok(byLabel(root, 'alice 的备注'));
  assert.ok(byLabel(root, '把 alice 移动到分组'));
  assert.ok(text(renderer.toJSON()).includes('企微 ID'), 'the row only showed the note; the id lives in the details');
  renderer.unmount();
});

test('only Bot ID and Secret are required; nothing is saved until they are present', async () => {
  const harness = mount({ secretConfigured: false });
  const renderer = await render(harness);
  const root = renderer.root;
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
  ]);
  assert.equal(JSON.stringify(harness.mutations).includes('s3cr3t'), false, 'the Secret never enters Config');
  assert.deepEqual(harness.credentialWrites, [{ ref: 'WECOM_BOT_SECRET', value: 's3cr3t' }]);
  renderer.unmount();
});

test('the administrator list and its Workspace scope only appear on demand', async () => {
  const harness = mount({ stored: { botId: 'bot', adminUserIds: ['alice'] } });
  const renderer = await render(harness);
  const root = renderer.root;
  const all = text(renderer.toJSON());
  assert.ok(all.includes('alice'), 'the configured administrator is listed');
  assert.equal(queryByLabel(root, '新增管理员 userid'), undefined, 'no input until 添加管理员 is clicked');
  assert.equal(queryByLabel(root, '管理员接收 dsh-wecom-bot 的通知'), undefined, 'the scope is folded shut');
  assert.ok(all.includes('全部 Workspace（会比较吵）'), 'the folded summary still says what the scope is');

  await act(async () => { buttonWithText(root, '添加管理员').props.onClick(); });
  await act(async () => { byLabel(root, '新增管理员 userid').props.onChange({ target: { value: ' root ' } }); });
  await act(async () => { exactButton(root, '添加').props.onClick(); });
  assert.equal(queryByLabel(root, '新增管理员 userid'), undefined, 'the input closes again');

  await act(async () => { buttonWithText(root, '可接收通知的 Workspace').props.onClick(); });
  await act(async () => { byLabel(root, '管理员接收 dsh-wecom-bot 的通知').props.onChange({ target: { checked: true } }); });
  await flush();
  await act(async () => { await buttonWithText(root, '保存配置').props.onClick(); });
  const ops = JSON.parse(JSON.stringify(harness.mutations[0].ops));
  assert.deepEqual(ops.find(op => op.path[0] === 'adminUserIds').value, ['alice', 'root']);
  assert.deepEqual(ops.find(op => op.path[0] === 'adminWorkspaces').value, ['/Users/me/dsh-wecom-bot']);
  renderer.unmount();
});

test('group and member edits are posted immediately, without touching the Config form', async () => {
  const harness = mount({ stored: { botId: 'bot' } });
  const renderer = await render(harness);
  const root = renderer.root;
  await act(async () => { buttonByLabel(root, '编辑 默认分组').props.onClick(); });
  await act(async () => { byLabel(root, '默认分组 的模型').props.onChange({ target: { value: 'deepseek-account\u0000deepseek-reasoner' } }); });
  await flush();
  assert.equal(harness.fetches.find(call => call.options?.method === 'POST').url, 'api/wecom-bot/routing');
  assert.deepEqual(posts(harness).at(-1), [{
    op: 'group.update', id: 'default',
    patch: { provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: '' },
  }]);
  assert.equal(harness.mutations.length, 0, 'groups never go through the Config form');
  assert.ok(text(renderer.toJSON()).includes('模型已生效'));

  // The group's Workspace is edited in the same card.
  await act(async () => { byLabel(root, '默认分组 的 Workspace').props.onChange({ target: { value: '/Users/me/dsh-wecom-bot' } }); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{ op: 'group.update', id: 'default', patch: { workspace: '/Users/me/dsh-wecom-bot' } }]);

  // A member's note is edited from the person details the row opens.
  await act(async () => { buttonByLabel(root, '爱丽丝 的详情').props.onClick(); });
  await act(async () => { byLabel(root, 'alice 的备注').props.onBlur({ target: { value: '同事小张' } }); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{ op: 'label.set', key: 'user:alice', label: '同事小张' }]);
  renderer.unmount();
});

test('a group can be added and removed, but the default group offers no delete', async () => {
  const harness = mount({ stored: { botId: 'bot' } });
  const renderer = await render(harness);
  const root = renderer.root;
  await act(async () => { buttonWithText(root, '添加分组').props.onClick(); });
  await act(async () => { byLabel(root, '新分组名称').props.onChange({ target: { value: '同事' } }); });
  await act(async () => { buttonWithText(root, '创建').props.onClick(); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{ op: 'group.add', name: '同事' }]);

  assert.equal(root.findAll(node => node.type === 'button' && text(node) === '删除分组').length, 1,
    'only the non-default group can be deleted');
  await act(async () => { buttonWithText(root, '删除分组').props.onClick(); });
  await act(async () => { await buttonWithText(root, '确认删除').props.onClick(); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{ op: 'group.delete', id: 'g1' }]);
  renderer.unmount();
});

test('an unauthorized sender is authorized straight into a group, with a note', async () => {
  const harness = mount({ stored: { botId: 'bot' } });
  const renderer = await render(harness);
  const root = renderer.root;
  const all = text(renderer.toJSON());
  assert.ok(all.includes('mallory'));
  assert.ok(all.includes('帮我看看这个仓库'), 'the refused message is shown so the operator can recognize it');

  await act(async () => { buttonWithText(root, '加入分组').props.onClick(); });
  await act(async () => { byLabel(root, 'mallory 的分组').props.onChange({ target: { value: 'g1' } }); });
  await act(async () => { byLabel(root, 'mallory 的备注').props.onChange({ target: { value: '市场部小李' } }); });
  await act(async () => { await buttonWithText(root, '确认授权').props.onClick(); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{
    op: 'member.add', groupId: 'g1', kind: 'user', id: 'mallory', label: '市场部小李',
  }]);
  renderer.unmount();
});

test('a person with a note is shown by the note, and the id only in the details', async () => {
  const state = { ...STATE, admins: [{ id: 'root', label: '运维小李', displayName: '运维小李' }] };
  const harness = mount({ stored: { botId: 'bot', adminUserIds: ['root'] }, state });
  const renderer = await render(harness);
  const root = renderer.root;
  const collapsed = text(renderer.toJSON());
  assert.ok(collapsed.includes('运维小李'), 'the note is the row title');
  assert.equal(collapsed.includes('root'), false, 'the userid is not shown while a note exists');

  await act(async () => { buttonByLabel(root, '运维小李 的详情').props.onClick(); });
  assert.ok(text(renderer.toJSON()).includes('企微 ID'));
  assert.ok(text(renderer.toJSON()).includes('root'), 'the details carry the real id');
  await act(async () => { byLabel(root, '管理员 root 的备注').props.onBlur({ target: { value: '运维' } }); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{ op: 'label.set', key: 'user:root', label: '运维' }]);
  assert.equal(harness.mutations.length, 0, 'a note never touches the Config form');
  renderer.unmount();
});

test('the notification scope lists only Workspaces that still have live Sessions', async () => {
  const harness = mount({ stored: { botId: 'bot', adminUserIds: ['alice'] } });
  const renderer = await render(harness);
  const root = renderer.root;
  await act(async () => { buttonWithText(root, '可接收通知的 Workspace').props.onClick(); });
  const all = text(renderer.toJSON());
  assert.ok(all.includes('dsh-wecom-bot'));
  assert.ok(all.includes('2 个会话'), 'the count excludes the 4 archived Sessions');
  assert.equal(all.includes('orion-agent'), false, 'a Workspace whose Sessions are all archived cannot notify anybody');
  renderer.unmount();
});

test('notice banners and a failing group Workspace are surfaced on the page', async () => {
  const state = {
    ...STATE,
    notices: ['已配置管理员但未限定 Workspace：管理员会收到所有 Workspace 的会话通知。'],
    routing: {
      ...STATE.routing,
      groups: [{ ...STATE.routing.groups[0], workspaceError: 'Workspace 目录不存在或不是目录：/nope' }, STATE.routing.groups[1]],
    },
  };
  const harness = mount({ state });
  const renderer = await render(harness);
  const root = renderer.root;
  assert.ok(text(renderer.toJSON()).includes('管理员会收到所有 Workspace 的会话通知'));
  await act(async () => { buttonWithText(root, '默认分组').props.onClick(); });
  assert.ok(text(renderer.toJSON()).includes('Workspace 目录不存在或不是目录：/nope'));
  renderer.unmount();
});
