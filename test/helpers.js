// Shared fakes for the Host tests. They mirror only what the plugin uses.
import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitize } from '../dist/host/journal.js';

export const tick = () => new Promise(resolve => setImmediate(resolve));

export async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i++) await tick();
}

/** Journal that keeps sanitized records in memory, exactly as they would be written. */
export function memoryJournal(secrets = []) {
  const records = [];
  return {
    records,
    write(record) { records.push(sanitize(record, secrets)); },
    flush: async () => {},
    close: async () => {},
    info: () => ({ enabled: true, directory: '/tmp/wecom-bot/logs', file: '/tmp/wecom-bot/logs/today.jsonl', retentionDays: 14 }),
    find(event) { return records.filter(record => record.event === event); },
  };
}

export function fakeClient() {
  const sends = [];
  const replies = [];
  const client = Object.assign(new EventEmitter(), {
    sends, replies,
    connected: false,
    connect() { this.connected = true; return this; },
    disconnect() { this.connected = false; },
    async sendMessage(chat, body) { sends.push({ chat, body }); return { headers: { req_id: `send_${sends.length}` }, errcode: 0, errmsg: 'ok' }; },
    async replyStream(frame, streamId, content, finish) { replies.push({ frame, streamId, content, finish }); return { headers: { req_id: frame.headers.req_id }, errcode: 0, errmsg: 'ok' }; },
  });
  return client;
}

/** One workspace directory per test run; the binding store writes a real file. */
export const scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wecom-bot-test-')));
let scratchCounter = 0;
export function scratchDirectory() {
  return join(scratchRoot, `case-${++scratchCounter}`);
}

export const TEST_WORKSPACE_PATH = join(scratchRoot, 'workspace');

/** Catalog payload DSH's `sessionController.modelCatalog()` answers with. */
export const fakeModelCatalog = {
  default: { provider: 'deepseek-account', model: 'deepseek-chat' },
  routableProviders: ['deepseek-account'],
  groups: [
    {
      id: 'deepseek-account', name: 'DeepSeek',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat' },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'high' } },
      ],
    },
  ],
  failures: [],
};

export function fakeWorkspaceRegistry(workspaces = []) {
  const rows = workspaces.map(workspace => ({ sessionIds: [], ...workspace }));
  return {
    rows,
    list: () => rows,
    get: id => rows.find(row => row.id === id),
    async create(path, title) {
      const found = rows.find(row => row.path === path);
      if (found) return found;
      const created = { id: `w${rows.length + 1}`, path, title: title ?? path.split('/').pop(), sessionIds: [] };
      rows.push(created);
      return created;
    },
    async resolveByPath(path) { return rows.find(row => row.path === path); },
    archivedSessionIds: [],
    pinnedSessionIds: [],
  };
}

/**
 * Host context with a Session list, an optional Workspace registry and
 * captured listeners. `sessions` rows follow sessionController.list; created
 * Sessions are appended (and attached to their Workspace) so the catalog sees
 * them exactly like the real registry would.
 */
export function fakeHost({ sessions, workspaces, archived = [], pinned = [], defaultModel } = {}) {
  const handlers = new Map();
  const prompts = [];
  const cancels = [];
  const listCalls = [];
  const creates = [];
  const selections = [];
  const defaultSaves = [];
  let currentDefault = defaultModel ?? { provider: 'deepseek-account', model: 'deepseek-chat' };
  const rows = sessions ?? [
    { sessionId: 's1', updatedAt: 200, running: false, blank: false, cwd: '/w/alpha', projections: { values: { title: 'Alpha 任务' } } },
    { sessionId: 's2', updatedAt: 100, running: true, blank: false, cwd: '/w/beta', projections: { values: { title: 'Beta 任务' } } },
  ];
  const registry = workspaces === undefined ? undefined : fakeWorkspaceRegistry(workspaces);
  const defaultModelService = {
    currentSelection: () => ({ ...currentDefault }),
    async saveSelection(next) { defaultSaves.push({ ...next }); currentDefault = { ...next }; },
  };
  const ctx = {
    handlers, prompts, cancels, listCalls, creates, selections, defaultSaves,
    rows, registry, defaultModelService,
    on(name, fn) { handlers.set(name, fn); return () => { if (handlers.get(name) === fn) handlers.delete(name); }; },
    get(name) {
      if (name === 'workspaceRegistry') return registry;
      if (name === 'agentDefaultModel') return defaultModelService;
      return undefined;
    },
    sessionController: {
      async prompt(request) {
        prompts.push(request);
        const row = rows.find(item => item.sessionId === request.sessionId);
        if (row) row.blank = false;
        return { accepted: true };
      },
      cancel(request) { cancels.push(request); return { accepted: true }; },
      async list(request, signal) { listCalls.push({ request, signal }); return { items: rows }; },
      async create(request) {
        creates.push(request);
        const workspace = request.workspaceId ? registry?.get(request.workspaceId) : undefined;
        const cwd = workspace?.path ?? request.cwd;
        const sessionId = `session-created-${creates.length}`;
        rows.push({ sessionId, updatedAt: Date.now(), running: false, blank: true, cwd, projections: { values: { title: null } } });
        if (workspace) workspace.sessionIds.push(sessionId);
        return { sessionId };
      },
      async selectModel(request) {
        selections.push(request);
        const selected = {
          provider: request.provider, model: request.model,
          ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
        };
        // DSH records the selection as a durable projection; the plugin reads it back.
        const row = rows.find(item => item.sessionId === request.sessionId);
        if (row) {
          row.projections ??= { values: {} };
          row.projections.values.modelSelection = { lastUsed: null, next: selected };
        }
        return { selected };
      },
      async modelCatalog() { return fakeModelCatalog; },
    },
  };
  return ctx;
}

let counter = 0;
export function frame(content, { chat = 'alice', user = 'alice', id, bot = 'bot', msgtype = 'text', quote } = {}) {
  const msgid = id ?? `m${++counter}`;
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req_${msgid}` },
    body: {
      msgid, aibotid: bot, msgtype,
      chattype: chat === user ? 'single' : 'group',
      ...(chat === user ? {} : { chatid: chat }),
      from: { userid: user },
      response_url: 'https://example.invalid/secret-callback',
      ...(msgtype === 'text' ? { text: { content } } : { image: { url: 'https://example.invalid/img', aeskey: 'k' } }),
      ...(quote !== undefined ? { quote: { msgtype: 'text', text: { content: quote } } } : {}),
    },
  };
}

/** A Session whose log ends with one finished turn. */
export function finishedSession(id, { turn = 1, text = '完成', reason = 'completed', promptIds = [] } = {}) {
  const events = [
    { type: 'turn/start', seq: 1, time: 1000, data: { turn } },
    ...promptIds.map((rpcId, index) => ({ type: 'user/message', seq: 2 + index, time: 1001, data: { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user', rpcId } } })),
    { type: 'request/header', seq: 10, time: 1002, data: { header: { config: { provider: 'p', model: 'm', reasoningEffort: 'high' } } } },
    { type: 'step/start', seq: 11, time: 1003, data: { turn, step: 1 } },
    { type: 'tool/call', seq: 12, time: 1004, data: { turn, step: 1, name: 'bash' } },
    { type: 'assistant/message', seq: 13, time: 1005, data: { turn, step: 2, message: { content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text }] } } },
  ];
  const end = { type: 'turn/end', seq: 20, time: 4000, data: { turn, reason: { kind: reason } } };
  events.push(end);
  return { session: { id, snapshotEvents: () => events }, end };
}

export const baseSettings = {
  botId: 'bot', secretRef: 'WECOM_BOT_SECRET', wsUrl: '',
  chatIds: [], allowedUserIds: [],
  defaultWorkspace: '', defaultProvider: '', defaultModel: '', defaultReasoningEffort: '',
  adminUserIds: [], adminWorkspaces: [],
  questionTimeoutMs: 1000, remoteApprovals: false,
};
