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
  version: 1,
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
        { sessionId: 'session-aaaa', title: '企业微信插件开发', running: true, pinned: true, updatedAt: Date.now() },
        { sessionId: 'session-bbbb', title: null, running: false, pinned: false, updatedAt: Date.now() - 3_600_000 },
      ] },
      { key: 'ungrouped', kind: 'ungrouped', title: '未分组', sessions: [
        { sessionId: 'session-cccc', title: '零散任务', running: false, pinned: false, updatedAt: 1 },
      ] },
    ],
    total: 3, archived: 4, generatedAt: Date.now(),
    hiddenSelections: [{ sessionId: 'session-old', title: '旧会话', reason: 'archived' }],
  },
  journal: { enabled: true, directory: '/Users/me/.dsh/wecom-bot/logs', file: '/Users/me/.dsh/wecom-bot/logs/2026-10-16.jsonl', retentionDays: 14 },
};

function mount({ stored = {}, secretConfigured = true } = {}) {
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
    async fetch(url, options) { fetches.push({ url, options }); return { ok: true, status: 200, json: async () => STATE }; },
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

  let snapshot = { status: 'ready', revision: 1, writable: true, value: { botId: '', chatIds: [], sessionIds: ['session-old'], allowedUserIds: [], ...stored } };
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
const byLabel = (root, label) => root.find(node => node.type === 'input' && node.props['aria-label'] === label);
const buttonWithText = (root, label) => root.find(node => node.type === 'button' && text(node).includes(label));

test('registers on the bundle homepage slot with the static module format', () => {
  const harness = mount();
  assert.equal(harness.entry.id, '@local/dsh-wecom-bot');
  assert.deepEqual([...harness.plugin.inject], ['slots', 'configForms', 'remote', 'remote.credentials']);
  assert.deepEqual({ ...harness.registration.options }, { name: 'plugins.bundle.config', key: '@local/dsh-wecom-bot' });
  assert.equal(harness.registration.component({ view: 'summary' }), null);
  assert.equal(harness.style.length, 1, 'stylesheet inserted once');
});

test('sessions are grouped by Workspace with titles before ids; archived ones are not listed', async () => {
  const harness = mount();
  const renderer = await render(harness);
  const root = renderer.root;
  assert.ok(harness.fetches.some(call => call.url === 'api/wecom-bot/state?refresh=1'));
  const all = text(renderer.toJSON().children ? { children: [renderer.toJSON()] } : renderer.toJSON());
  assert.ok(all.indexOf('dsh-wecom-bot') < all.indexOf('企业微信插件开发'));
  assert.ok(all.indexOf('企业微信插件开发') < all.indexOf('session-aaaa'), 'title before id');
  assert.ok(all.includes('未命名会话'));
  assert.ok(all.includes('已隐藏 4 个已归档会话'));
  assert.ok(all.includes('已勾选但当前不可操作'));
  assert.ok(all.includes('上次被拒绝'), 'rejected IDs are listed');
  assert.ok(all.includes('安全风险') === false, 'one allowlist is set, so the banner is a warning, not the open-risk alert');
  assert.ok(all.includes('部分范围未限制'));
  assert.ok(byLabel(root, '选择会话 企业微信插件开发'));
  assert.ok(byLabel(root, '允许用户 mallory'));
  renderer.unmount();
});

test('only Bot ID and Secret are required; nothing is saved until they are present', async () => {
  const harness = mount({ stored: { sessionIds: [] }, secretConfigured: false });
  const renderer = await render(harness);
  const root = renderer.root;
  assert.ok(text(renderer.toJSON()).includes('安全风险：尚未设置任何白名单'));
  await act(async () => { byLabel(root, '选择会话 零散任务').props.onChange({ target: { checked: true } }); });
  await act(async () => { buttonWithText(root, '保存配置').props.onClick(); });
  assert.equal(harness.mutations.length, 0);
  assert.ok(text(renderer.toJSON()).includes('请填写企业微信 Bot ID'));
  assert.ok(text(renderer.toJSON()).includes('首次配置需要填写 Bot Secret'));
  await act(async () => { byLabel(root, 'Bot ID').props.onChange({ target: { value: 'aib-123' } }); });
  await act(async () => { byLabel(root, 'Bot Secret').props.onChange({ target: { value: 's3cr3t' } }); });
  await act(async () => { await buttonWithText(root, '保存配置').props.onClick(); });
  await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
  assert.equal(harness.mutations.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.mutations[0].ops)), [
    { op: 'set', path: ['botId'], value: 'aib-123' },
    { op: 'set', path: ['sessionIds'], value: ['session-cccc'] },
  ]);
  assert.equal(JSON.stringify(harness.mutations).includes('s3cr3t'), false, 'the Secret never enters Config');
  assert.deepEqual(harness.credentialWrites, [{ ref: 'WECOM_BOT_SECRET', value: 's3cr3t' }]);
  assert.equal(byLabel(root, 'Bot Secret').props.value, '', 'the Secret field is cleared after saving');
  renderer.unmount();
});

test('selecting a Workspace group selects all of its Sessions, and identities can be allowlisted', async () => {
  const harness = mount({ stored: { botId: 'bot', sessionIds: [] } });
  const renderer = await render(harness);
  const root = renderer.root;
  await act(async () => { byLabel(root, '选择工作区 dsh-wecom-bot 的全部会话').props.onChange({ target: { checked: true } }); });
  await act(async () => { byLabel(root, '允许用户 alice').props.onChange({ target: { checked: true } }); });
  await act(async () => { await buttonWithText(root, '保存配置').props.onClick(); });
  const ops = JSON.parse(JSON.stringify(harness.mutations[0].ops));
  assert.deepEqual(ops.find(op => op.path[0] === 'sessionIds').value, ['session-aaaa', 'session-bbbb']);
  assert.deepEqual(ops.find(op => op.path[0] === 'allowedUserIds').value, ['alice']);
  assert.equal(harness.credentialWrites.length, 0, 'a stored Secret is kept when the field is empty');
  renderer.unmount();
});
