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

// Minimal stand-ins for the DSH Web shell primitives. The real Modal portals to
// document.body; here its children render inline so the tree stays inspectable.
const primitives = new Proxy({
  Button: ({ variant, size, icon, children, ...rest }) => h('button', { ...rest, 'data-variant': variant }, icon, children),
  Input: ({ icon, ...rest }) => h('input', rest),
  Switch: ({ checked, onChange, label, disabled }) => h('button', { role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled, onClick: () => onChange(!checked) }),
  Tag: ({ tone, children }) => h('span', { 'data-tone': tone }, children),
  StateDot: ({ state }) => h('i', { 'data-state': state }),
  Modal: ({ open, onClose, title, closeLabel, children, footer }) => (open
    ? h('div', { role: 'dialog', 'aria-label': typeof title === 'string' ? title : undefined },
      h('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }),
      children,
      footer)
    : null),
  writeClipboard: async () => true,
}, { get: (target, key) => target[key] ?? (() => null) });

const STATE = {
  version: '0.5',
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
        { sessionId: 'session-aaaa', title: '企业微信插件开发', running: true, pinned: true, updatedAt: Date.now(), model: { provider: 'deepseek-account', model: 'deepseek-chat' }, preset: 'standard', context: { used: 12_300, window: 200_000 } },
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
        provider: '', model: '', effectiveProvider: '', effectiveModel: '', preset: '',
        memberCount: 1, messages: 2, lastSeenAt: Date.now(),
        members: [{
          key: 'user:alice', kind: 'user', id: 'alice', label: '爱丽丝', displayName: '爱丽丝', admin: false,
          sessionId: 'session-aaaa', sessionTitle: '企业微信插件开发', sessionState: 'bound', sessionRunning: true,
          sessionModel: { provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'high' },
          sessionPreset: 'standard', sessionContext: { used: 12_300, window: 200_000 },
          messages: 2, lastSeenAt: Date.now(), createdAt: 1,
        }],
      },
      {
        id: 'g1', name: '朋友', isDefault: false,
        workspace: '/Users/me/dsh-wecom-bot', workspaceTitle: 'dsh-wecom-bot', workspacePath: '/Users/me/dsh-wecom-bot',
        provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'high', preset: 'ptc',
        effectiveProvider: 'deepseek-account', effectiveModel: 'deepseek-reasoner', effectiveReasoningEffort: 'high',
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
  presets: {
    presets: [
      { id: 'standard', isDefault: true },
      { id: 'ptc' },
      { id: 'minimal' },
    ],
    fetchedAt: Date.now(),
  },
  workspaces: [
    { id: 'w1', path: '/Users/me/dsh-wecom-bot', title: 'dsh-wecom-bot', pluginOwned: false, sessionCount: 2, archivedSessionCount: 4 },
    // Every Session archived: it can never notify anybody, so the scope list hides it.
    { id: 'w2', path: '/Users/me/orion-agent', title: 'orion-agent', pluginOwned: false, sessionCount: 0, archivedSessionCount: 32 },
  ],
  // The store's settings block: ④管理员 and ⑤高级设置 edit this, not the Config.
  settings: {
    wsUrl: '',
    adminUserIds: [],
    adminWorkspaces: [],
    questionTimeoutMs: 60000,
    remoteApprovals: false,
    logEnabled: true,
    logRetentionDays: 14,
  },
  admins: [{ id: 'alice', label: '', displayName: 'alice' }],
  notices: [],
  journal: { enabled: true, directory: '/Users/me/.dsh/wecom-bot/logs', file: '/Users/me/.dsh/wecom-bot/logs/2026-10-16.jsonl', retentionDays: 14 },
};

/** The sample page with part of the store's settings block replaced. */
const withSettings = patch => ({ ...STATE, settings: { ...STATE.settings, ...patch } });

function mount({ stored = {}, secretConfigured = true, state = STATE, postError } = {}) {
  let current = state;
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
      let body = current;
      if (options?.method === 'POST') {
        if (postError) return { ok: false, status: 422, json: async () => ({ ok: false, error: postError }) };
        const ops = JSON.parse(options.body).ops;
        const added = ops.some(op => op.op === 'group.add');
        // The Host merges a settings patch field by field into its own document,
        // so the next read answers with what was just written — the authority the
        // page polls, rather than the write's own answer.
        for (const op of ops) {
          if (op.op === 'settings.set') current = { ...current, settings: { ...current.settings, ...op.patch } };
        }
        body = { ok: true, routing: current.routing, settings: current.settings, ...(added ? { createdGroupId: 'g-new' } : {}) };
      }
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
    value: { botId: '', ...stored },
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
  return {
    entry, plugin, registration, mutations, credentialWrites, fetches, style, intervals,
    /** Replace what the next read answers with (a Host write landing between two polls). */
    setState(next) { current = next; },
  };
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
  assert.ok(all.includes('1 位成员'));
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
  assert.ok(byLabel(root, '默认分组 的 effort'), 'effort is configurable beside the model');
  assert.ok(byLabel(root, '默认分组 的 preset'));
  assert.equal(queryByLabel(root, '朋友 的名称'), undefined, 'the other group stays untouched');
  // The badge — and only the badge — opens the person details.
  assert.equal(buttonByLabel(root, '爱丽丝 的详情').type, 'button');
  await act(async () => { buttonByLabel(root, '爱丽丝 的详情').props.onClick(); });
  assert.ok(byLabel(root, 'alice 的备注'));
  assert.ok(byLabel(root, '把 alice 移动到分组'));
  assert.ok(text(renderer.toJSON()).includes('企微 ID'), 'the row only showed the note; the id lives in the details');
  renderer.unmount();
});

test('a collapsed group names its Workspace, model, effort and preset', async () => {
  const harness = mount();
  const renderer = await render(harness);
  const summaries = renderer.root
    .findAll(node => node.props?.className === 'wcb-group-summary' && text(node).includes('位成员'))
    .map(text);
  assert.equal(summaries.length, 2, 'one overview per group');
  const [following, set] = summaries;

  // The default group follows DSH; the overview names what that resolves to.
  assert.match(following, /^1 位成员/);
  assert.ok(following.includes('Workspace企业微信'));
  assert.ok(following.includes('模型DeepSeek Chat（DSH 默认）'));
  assert.ok(following.includes('effort默认'), 'an unset effort says so instead of disappearing');
  assert.ok(following.includes('preset标准（DSH 默认）'));

  // A group that sets them shows the values it sets, each under its own name.
  assert.ok(set.includes('Workspacedsh-wecom-bot'));
  assert.ok(set.includes('模型DeepSeek Reasoner'));
  assert.ok(set.includes('effort高'));
  assert.ok(set.includes('presetPTC'));
  renderer.unmount();
});

test('a person row names nobody by type: the badge colors a person from a group chat', async () => {
  const harness = mount();
  const renderer = await render(harness);
  const root = renderer.root;
  await act(async () => { buttonWithText(root, '默认分组').props.onClick(); });
  await act(async () => { buttonWithText(root, '朋友').props.onClick(); });
  const rows = root.findAll(node => node.props?.['data-kind'] === 'user' || node.props?.['data-kind'] === 'group');
  const kinds = rows.map(node => node.props['data-kind']);
  assert.ok(kinds.includes('user'), 'alice is a private chat');
  assert.ok(kinds.includes('group'), 'wrOgAAAA is a group chat');
  // Every person-ish row (two members, one refused sender) drops the type word.
  const memberRows = root.findAll(node => node.type === 'div'
    && (node.props.className === 'wcb-member-row' || node.props.className === 'wcb-member'));
  assert.ok(memberRows.length >= 3, `found ${memberRows.length} person rows`);
  for (const row of memberRows) {
    const line = text(row);
    assert.equal(line.includes('个人'), false, 'the row no longer spells the type out');
    assert.equal(line.includes('群聊'), false);
  }
  renderer.unmount();
});

test('a member is one line: its Session facts, and 归档 as the only action', async () => {
  const harness = mount();
  const renderer = await render(harness);
  const root = renderer.root;
  await act(async () => { buttonWithText(root, '默认分组').props.onClick(); });
  const row = root.find(node => node.type === 'div' && node.props.className === 'wcb-member-row');
  const line = text(row);
  assert.ok(line.includes('爱丽丝'), 'the name');
  assert.ok(line.includes('企业微信插件开发'), 'the Session name');
  assert.ok(line.includes('标准'), 'the preset it runs');
  assert.ok(line.includes('DeepSeek Reasoner'), 'the model of its last request');
  assert.ok(line.includes('高'), 'and the effort it uses');
  assert.ok(line.includes('12.3k / 200k'), 'and how full its context is');
  assert.equal(queryByLabel(root, 'alice 的会话选择'), undefined, 'a Session picker is gone');
  assert.equal(line.includes('+ 添加成员'), false);
  assert.equal(text(renderer.toJSON()).includes('添加成员'), false, 'members are authorized from 未授权用户 only');

  // 归档 is the one action: a confirmation first, then the Host archives it.
  await act(async () => { buttonByLabel(root, '归档 爱丽丝 的会话').props.onClick(); });
  assert.ok(text(renderer.toJSON()).includes('归档后这个会话不再被继续'));
  await act(async () => { await buttonByText(root, '确认归档').props.onClick(); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{ op: 'member.archive', key: 'user:alice' }]);
  renderer.unmount();
});

const buttonByText = (root, label) => root.findAll(node => node.type === 'button' && text(node) === label)[0];

test('a card saves only its own section, and nothing is saved while it is untouched', async () => {
  const harness = mount({ secretConfigured: false });
  const renderer = await render(harness);
  const root = renderer.root;
  assert.equal(buttonByText(root, '保存'), undefined, 'no section is dirty, so no save button is offered');

  await act(async () => { byLabel(root, 'Bot ID').props.onChange({ target: { value: 'aib-123' } }); });
  await act(async () => { await buttonByText(root, '保存').props.onClick(); });
  await flush();
  assert.equal(harness.mutations.length, 0, 'a missing Secret blocks the write');
  assert.ok(text(renderer.toJSON()).includes('首次配置需要填写 Bot Secret'));

  await act(async () => { byLabel(root, 'Bot Secret').props.onChange({ target: { value: 's3cr3t' } }); });
  await act(async () => { await buttonByText(root, '保存').props.onClick(); });
  await flush();
  assert.equal(harness.mutations.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.mutations[0].ops)), [
    { op: 'set', path: ['botId'], value: 'aib-123' },
  ]);
  assert.equal(JSON.stringify(harness.mutations).includes('s3cr3t'), false, 'the Secret never enters Config');
  assert.deepEqual(harness.credentialWrites, [{ ref: 'WECOM_BOT_SECRET', value: 's3cr3t' }]);
  assert.ok(text(renderer.toJSON()).includes('已保存。'), 'the card confirms its own save');
  renderer.unmount();
});

test('adding an administrator searches known people by note, and writes at once', async () => {
  const harness = mount({ state: withSettings({ adminUserIds: ['alice'] }) });
  const renderer = await render(harness);
  const root = renderer.root;
  const all = text(renderer.toJSON());
  assert.ok(all.includes('alice'), 'the stored administrator is listed');
  assert.equal(all.includes('未设置'), false, 'the empty tag became an add button');
  assert.equal(root.findAll(node => node.type === 'button' && text(node) === '保存').length, 0,
    'the card has no 保存 button: every edit is written when it is made');

  await act(async () => { exactButton(root, '添加').props.onClick(); });
  assert.ok(byLabel(root, '搜索已知用户'), 'the picker has a search box');
  assert.ok(text(renderer.toJSON()).includes('mallory'), 'a refused sender is a candidate');
  assert.ok(text(renderer.toJSON()).includes('未授权用户'), 'and says where it comes from');

  await act(async () => { byLabel(root, '搜索已知用户').props.onChange({ target: { value: 'mal' } }); });
  await act(async () => {
    root.findAll(node => node.type === 'button' && node.props.className === 'wcb-picker-row')[0].props.onClick();
  });
  await flush();
  assert.equal(harness.fetches.find(call => call.options?.method === 'POST').url, 'api/wecom-bot/store');
  assert.deepEqual(posts(harness).at(-1), [{ op: 'settings.set', patch: { adminUserIds: ['alice', 'mallory'] } }],
    'picking somebody writes the store, not the Config');
  assert.equal(harness.mutations.length, 0, 'the administrator list left the Config form');
  assert.ok(text(renderer.toJSON()).includes('mallory'), 'the new administrator is listed');
  renderer.unmount();
});

test('the notification scope is all-checked by default and narrows only when unchecked', async () => {
  const harness = mount({ state: withSettings({ adminUserIds: ['alice'] }) });
  const renderer = await render(harness);
  const root = renderer.root;
  assert.ok(text(renderer.toJSON()).includes('全部 Workspace'), 'the folded summary says the default');

  await act(async () => { buttonWithText(root, '可接收通知的 Workspace').props.onClick(); });
  const all = text(renderer.toJSON());
  assert.ok(all.includes('dsh-wecom-bot'));
  assert.ok(all.includes('orion-agent'), 'a Workspace whose Sessions are all archived is still listed');
  assert.ok(all.includes('暂无会话'));
  assert.ok(all.includes('2 个会话'), 'the live count excludes the 4 archived Sessions');
  assert.equal(byLabel(root, '管理员接收 dsh-wecom-bot 的通知').props.checked, true, 'empty scope = every box checked');
  assert.equal(byLabel(root, '管理员接收 orion-agent 的通知').props.checked, true);

  // Unchecking one Workspace stores the remaining path, not a list of all of them.
  await act(async () => { byLabel(root, '管理员接收 dsh-wecom-bot 的通知').props.onChange({ target: { checked: false } }); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{ op: 'settings.set', patch: { adminWorkspaces: ['/Users/me/orion-agent'] } }],
    'a checkbox writes the narrowed scope immediately');
  assert.equal(byLabel(root, '管理员接收 dsh-wecom-bot 的通知').props.checked, false, 'and the box reflects it');
  assert.ok(text(renderer.toJSON()).includes('1 / 2 个 Workspace'), 'the summary counts what is left');

  // Checking the last one back collapses the list to the empty "all" it means.
  await act(async () => { byLabel(root, '管理员接收 dsh-wecom-bot 的通知').props.onChange({ target: { checked: true } }); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{ op: 'settings.set', patch: { adminWorkspaces: [] } }],
    'a scope covering every Workspace is stored as the default, not as today\'s paths');
  assert.equal(byLabel(root, '管理员接收 orion-agent 的通知').props.checked, true);
  assert.ok(text(renderer.toJSON()).includes('全部 Workspace'));
  renderer.unmount();
});

test('removing an administrator is written immediately too', async () => {
  const harness = mount({ state: withSettings({ adminUserIds: ['alice'] }) });
  const renderer = await render(harness);
  const root = renderer.root;
  await act(async () => { buttonByLabel(root, 'alice 的详情').props.onClick(); });
  await act(async () => { buttonByLabel(root, '移除管理员 alice').props.onClick(); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{ op: 'settings.set', patch: { adminUserIds: [] } }],
    'the dialog removes the administrator without a second click');
  assert.equal(text(renderer.toJSON()).includes('还没有管理员'), true, 'and the card shows the empty state');
  renderer.unmount();
});

test('⑤保存 writes one settings patch, converting the seconds the field shows into milliseconds', async () => {
  const harness = mount();
  const renderer = await render(harness);
  const root = renderer.root;
  const advanced = root.find(node => node.type === 'details');

  // The endpoint is the one field here that is half of the connection.
  assert.ok(text(advanced).includes('保存这一项会重新连接机器人'));
  assert.ok(text(advanced).includes('不会断开正在进行的对话'), 'and the rest of the card says it applies live');
  assert.equal(advanced.findAll(node => node.type === 'button' && text(node) === '保存').length, 0,
    'an untouched card offers no save button');

  await act(async () => { byLabel(root, '等待企微回复的秒数').props.onChange({ target: { value: '30' } }); });
  assert.equal(byLabel(root, '等待企微回复的秒数').props.value, 30, 'the field is a whole number of seconds');
  await act(async () => { advanced.findAll(node => node.type === 'button' && text(node) === '保存')[0].props.onClick(); });
  await flush();
  assert.equal(harness.fetches.find(call => call.options?.method === 'POST').url, 'api/wecom-bot/store');
  assert.deepEqual(posts(harness).at(-1), [{ op: 'settings.set', patch: { questionTimeoutMs: 30000 } }],
    'the store keeps milliseconds, the field shows seconds');
  assert.equal(harness.mutations.length, 0, 'the advanced knobs left the Config form');
  assert.ok(text(renderer.toJSON()).includes('已保存。'), 'the card confirms its own save');

  // A later edit writes only what that edit moved: the saved timeout is the
  // stored one now, so it is not written back a second time.
  await act(async () => { byLabel(root, 'WebSocket 地址').props.onChange({ target: { value: ' wss://openws.example ' } }); });
  await act(async () => { advanced.findAll(node => node.type === 'button' && text(node) === '保存')[0].props.onClick(); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{ op: 'settings.set', patch: { wsUrl: 'wss://openws.example' } }],
    'one patch, trimmed, for the field that moved');
  renderer.unmount();
});

test('a refused settings write shows the Host message as it arrived, and keeps the draft', async () => {
  const harness = mount({ postError: '「等待企微回复」需要在 1–300 秒之间。' });
  const renderer = await render(harness);
  const root = renderer.root;
  await act(async () => { byLabel(root, '等待企微回复的秒数').props.onChange({ target: { value: '30' } }); });
  await act(async () => {
    root.find(node => node.type === 'details')
      .findAll(node => node.type === 'button' && text(node) === '保存')[0].props.onClick();
  });
  await flush();
  assert.ok(text(renderer.toJSON()).includes('「等待企微回复」需要在 1–300 秒之间。'),
    'the Host is the authority, so its explanation is what the operator reads');
  assert.equal(byLabel(root, '等待企微回复的秒数').props.value, 30, 'the edit is still there to fix');
  assert.equal(harness.mutations.length, 0);
  renderer.unmount();
});

test('a group is edited as one draft: 编辑 becomes 保存 and posts a single patch', async () => {
  const harness = mount({ stored: { botId: 'bot' } });
  const renderer = await render(harness);
  const root = renderer.root;
  await act(async () => { buttonByLabel(root, '编辑 默认分组').props.onClick(); });
  assert.equal(root.findAll(node => node.props?.['aria-label'] === '编辑 默认分组').length, 0, 'the edit button became 保存');
  assert.ok(buttonByText(root, '保存'));

  await act(async () => { byLabel(root, '默认分组 的模型').props.onChange({ target: { value: 'deepseek-account\u0000deepseek-reasoner' } }); });
  await act(async () => { byLabel(root, '默认分组 的 Workspace').props.onChange({ target: { value: '/Users/me/dsh-wecom-bot' } }); });
  await act(async () => { byLabel(root, '默认分组 的 preset').props.onChange({ target: { value: 'ptc' } }); });
  await flush();
  assert.equal(posts(harness).length, 0, 'nothing is written until 保存');

  await act(async () => { await buttonByText(root, '保存').props.onClick(); });
  await flush();
  assert.equal(harness.fetches.find(call => call.options?.method === 'POST').url, 'api/wecom-bot/store');
  assert.deepEqual(posts(harness).at(-1), [{
    op: 'group.update', id: 'default',
    patch: {
      provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: '',
      workspace: '/Users/me/dsh-wecom-bot', preset: 'ptc',
    },
  }]);
  assert.equal(harness.mutations.length, 0, 'groups never go through the Config form');
  assert.equal(text(renderer.toJSON()).includes('已生效'), false, 'and no banner outlives the edit');

  // A member's note is edited from the person details the badge opens.
  await act(async () => { buttonByLabel(root, '爱丽丝 的详情').props.onClick(); });
  await act(async () => { byLabel(root, 'alice 的备注').props.onBlur({ target: { value: '同事小张' } }); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{ op: 'label.set', key: 'user:alice', label: '同事小张' }]);
  renderer.unmount();
});

test('the effort of a group is adjustable next to its model, and reported in the summary', async () => {
  const state = {
    ...STATE,
    routing: {
      ...STATE.routing,
      groups: [{
        ...STATE.routing.groups[0],
        provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'low',
        effectiveProvider: 'deepseek-account', effectiveModel: 'deepseek-reasoner', effectiveReasoningEffort: 'low',
      }, STATE.routing.groups[1]],
    },
  };
  const harness = mount({ stored: { botId: 'bot' }, state });
  const renderer = await render(harness);
  const root = renderer.root;
  const overview = text(renderer.toJSON());
  assert.ok(overview.includes('模型DeepSeek Reasoner'), 'the collapsed summary names the model');
  assert.ok(overview.includes('effort低'), 'and the effort it runs with');

  await act(async () => { buttonByLabel(root, '编辑 默认分组').props.onClick(); });
  await act(async () => { byLabel(root, '默认分组 的 effort').props.onChange({ target: { value: 'high' } }); });
  await act(async () => { await buttonByText(root, '保存').props.onClick(); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{
    op: 'group.update', id: 'default',
    patch: { reasoningEffort: 'high' },
  }]);
  renderer.unmount();
});

test('a new group opens its complete form at once, and can be removed later', async () => {
  const harness = mount({ stored: { botId: 'bot' } });
  const renderer = await render(harness);
  const root = renderer.root;
  // The Host answers with the new group; the page opens it in edit mode.
  harness.setState({
    ...STATE,
    routing: {
      ...STATE.routing,
      groups: [...STATE.routing.groups, {
        id: 'g-new', name: '分组 2', isDefault: false, workspace: '', workspaceTitle: '企业微信',
        workspacePath: '/Users/me/.dsh/wecom-bot/workspace', provider: '', model: '',
        effectiveProvider: '', effectiveModel: '', preset: '', memberCount: 0, messages: 0, members: [],
      }],
    },
  });
  await act(async () => { buttonWithText(root, '添加分组').props.onClick(); });
  await flush();
  assert.deepEqual(posts(harness).at(-1), [{ op: 'group.add' }], 'no name prompt: the group is created with defaults');
  assert.ok(byLabel(root, '分组 2 的名称'), 'the new group is already in its form');
  assert.ok(byLabel(root, '分组 2 的 Workspace'));
  assert.ok(byLabel(root, '分组 2 的 preset'));

  // The default group offers no delete; the two created ones do.
  assert.equal(root.findAll(node => node.type === 'button' && text(node) === '删除分组').length, 2);
  await act(async () => { root.findAll(node => node.type === 'button' && text(node) === '删除分组')[0].props.onClick(); });
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
  const state = withSettings({ adminUserIds: ['root'] });
  state.admins = [{ id: 'root', label: '运维小李', displayName: '运维小李' }];
  const harness = mount({ state });
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
