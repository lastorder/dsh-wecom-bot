import { randomUUID } from 'node:crypto';
import type { WSClient, WsFrame } from '@wecom/aibot-node-sdk';
import { createCatalogService, type CatalogService } from '../catalog.js';
import type { BridgeSettings } from '../config.js';
import { bindingKey, bindingKeyFor } from '../bindings.js';
import type {
  ApprovalOutcome, ApprovalRequest, HostContext, Logger, QuestionAnswer, QuestionRequest,
  SessionEvent, SessionHandle,
} from '../dsh.js';
import { nullJournal, type Journal } from '../journal.js';
import { createObservationStore, type ObservationStore } from '../observation.js';
import { createRoundTracker, type Round, type RoundTracker } from '../rounds.js';
import { createStatusTracker, type StatusTracker } from '../status.js';
import type { TurnSummary } from '../turns.js';
import type { Router } from '../routing.js';
import { parseCommand, runCommand, type CommandServices, type TargetInfo } from './commands.js';
import { createSessionDirectory, type SessionDirectory } from './directory.js';
import { byteLength, limitBytes, MAX_INBOUND_BYTES, MAX_REPLY_BYTES, displayTitle, extractSessionPointer, oneLine } from './format.js';
import { createReplayGuard, parseInbound, type InboundMessage } from './inbound.js';
import { createInteractionRegistry } from './interactions.js';
import {
  approvalNotice, promptFailedNotice, questionNotice, reviewNotice, turnCompleteNotice,
} from './notices.js';
import { ackSummary, createOutbox, type NoticeKind } from './outbox.js';
import { createAccessPolicy } from './policy.js';
import { createSelectionStore } from './selection.js';

/**
 * One live WeCom connection bound to one settings snapshot.
 *
 * The bridge owns the socket listeners, the access policy, the notification
 * queue and pending WeCom answers. Routing itself — which Session a
 * conversation owns — belongs to the Host-lifetime router, so replacing the
 * bridge (a Config change) never loses a binding or a pending round.
 *
 * Notification recipients are the conversations bound to the Session plus
 * every administrator whose Workspace scope covers it: unlike the previous
 * release this no longer depends on who has messaged the Bot since the
 * process started.
 */

export type BridgeClient = Pick<WSClient, 'on' | 'connect' | 'disconnect' | 'removeAllListeners' | 'sendMessage' | 'replyStream'>;

export interface BridgeDeps {
  readonly ctx: Pick<HostContext, 'on' | 'sessionController'>;
  readonly client: BridgeClient;
  readonly settings: BridgeSettings;
  readonly router: Router;
  readonly log?: Logger;
  readonly journal?: Journal;
  readonly observations?: ObservationStore;
  readonly rounds?: RoundTracker;
  readonly catalogs?: CatalogService;
  readonly status?: StatusTracker;
  /** Removes secrets from SDK-provided text before it is shown or logged. */
  readonly scrub?: (text: string) => string;
}

export interface Bridge {
  start(): () => void;
  handleFrame(frame: WsFrame): Promise<void>;
  /** Notify WeCom about a finished turn; resolves to the notified conversations. */
  onTurnEnd(session: SessionHandle, end: SessionEvent, summary: () => TurnSummary): Promise<readonly string[]>;
  onQuestion(request: QuestionRequest, next: () => Promise<QuestionAnswer>): Promise<QuestionAnswer>;
  onApproval(request: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>;
  readonly directory: SessionDirectory;
  readonly observations: ObservationStore;
  readonly rounds: RoundTracker;
}

export function createBridge(deps: BridgeDeps): Bridge {
  const { ctx, client, settings, router } = deps;
  const log = deps.log ?? console;
  const journal = deps.journal ?? nullJournal;
  const observations = deps.observations ?? createObservationStore();
  const rounds = deps.rounds ?? createRoundTracker({ journal });
  const status = deps.status ?? createStatusTracker(journal);
  const scrub = deps.scrub ?? ((text: string) => text);
  const catalogs = deps.catalogs ?? createCatalogService({
    list: async signal => (await ctx.sessionController.list({}, signal)).items,
    registry: () => undefined,
  });

  const policy = createAccessPolicy(settings);
  const directory = createSessionDirectory(catalogs, {
    allow: entry => policy.adminWorkspaceAllowed(entry.group.path),
  });
  const selection = createSelectionStore();
  const interactions = createInteractionRegistry();
  const outbox = createOutbox({ client, journal, log, status });
  const replay = createReplayGuard();
  const lifetime = new AbortController();
  let closed = false;
  let started = false;
  let displaced = false;
  let generation = 0;

  const stale = (ticket: number) => closed || ticket !== generation;
  const parts = (message: InboundMessage) => ({ chat: message.chat, user: message.user, chatType: message.chatType });

  /** The Session a sender talks to right now, without creating anything. */
  async function currentTarget(message: InboundMessage): Promise<TargetInfo> {
    if (policy.isAdmin(message.user)) {
      const choice = selection.get(message.chat, message.user);
      if (choice) {
        if (await directory.permitted(choice)) return { sessionId: choice, switched: true };
        selection.clear(message.chat, message.user);
      }
    }
    const binding = router.store.get(bindingKeyFor(parts(message)));
    return {
      ...(binding?.sessionId ? { sessionId: binding.sessionId } : {}),
      ...(binding ? { binding } : {}),
      switched: false,
    };
  }

  /** The Session a prompt must go to; creates the binding's Session when needed. */
  async function routeTarget(message: InboundMessage): Promise<
    { readonly ok: true; readonly sessionId: string } | { readonly ok: false; readonly message: string }
  > {
    const switched = await currentTarget(message);
    if (switched.switched && switched.sessionId) return { ok: true, sessionId: switched.sessionId };
    const routed = await router.route(parts(message));
    if (!routed.ok || !routed.sessionId) {
      return { ok: false, message: routed.message ?? '无法为你创建专属会话，请稍后重试。' };
    }
    if (routed.created) {
      journal.write({
        event: 'session.created', chatId: message.chat, userId: message.user,
        sessionId: routed.sessionId, binding: routed.binding ? bindingKey(routed.binding.kind, routed.binding.id) : undefined,
      });
    }
    return { ok: true, sessionId: routed.sessionId };
  }

  /** Single chats are the only place a tool call may be authorized. */
  function isPrivateChat(chat: string): boolean {
    const binding = router.store.get(bindingKey('user', chat));
    if (binding) return true;
    return observations.snapshot().chats.some(entry => entry.id === chat && entry.chatType === 'single');
  }

  /**
   * Conversations that may receive automatic messages about this Session:
   * every binding pointing at it, plus the administrators whose Workspace
   * scope covers it. `reason` only labels the {@link journal} warning emitted
   * when nobody qualifies, which is the only trace of a skipped notice.
   */
  async function recipients(sessionId: string, reason: NoticeKind): Promise<string[]> {
    const chats = new Set<string>();
    for (const binding of router.forSession(sessionId)) chats.add(binding.id);
    if (settings.adminUserIds.length) {
      const info = await directory.describe(sessionId);
      if (info.workspacePath && policy.adminWorkspaceAllowed(info.workspacePath)) {
        for (const admin of settings.adminUserIds) chats.add(admin);
      }
    }
    const unique = [...chats];
    if (!unique.length) {
      journal.write({
        event: 'wecom.notify.skipped', level: 'warn', sessionId, reason,
        detail: 'no binding points at this Session and no administrator scope covers its Workspace',
      });
    }
    return unique;
  }

  function notify(chats: readonly string[], text: string, kind: NoticeKind, sessionId?: string): void {
    for (const chat of chats) outbox.enqueue({ chat, text, kind, ...(sessionId ? { sessionId } : {}) });
  }

  async function reply(message: InboundMessage, round: Round, text: string): Promise<void> {
    if (closed) return;
    const content = limitBytes(text, MAX_REPLY_BYTES);
    const streamId = `stream_${randomUUID()}`;
    rounds.reply(round, content);
    const startedAt = Date.now();
    const meta = { roundId: round.id, chatId: message.chat, userId: message.user, reqId: message.reqId };
    try {
      const ack = await client.replyStream(message.frame, streamId, content, true);
      journal.write({ event: 'wecom.reply', ...meta, request: { streamId, content, finish: true }, response: ackSummary(ack), durationMs: Date.now() - startedAt });
    } catch (error) {
      status.count('failures');
      log.warn('WeCom reply failed');
      journal.write({ event: 'wecom.reply', level: 'warn', ...meta, request: { streamId, content, finish: true }, error, durationMs: Date.now() - startedAt });
    }
  }

  const commandServices: CommandServices = {
    policy, directory, selection, interactions, journal,
    sessionController: ctx.sessionController,
    current: currentTarget,
    async reset(message) {
      selection.clear(message.chat, message.user);
      const binding = router.store.get(bindingKeyFor(parts(message)));
      if (!binding) {
        await router.ensure(parts(message));
        return;
      }
      if (binding.sessionId) await router.store.update(bindingKey(binding.kind, binding.id), { sessionId: '' });
      journal.write({ event: 'binding.session.reset', binding: bindingKey(binding.kind, binding.id), sessionId: binding.sessionId });
    },
    stale,
    ticket: () => generation,
  };

  async function submitPrompt(message: InboundMessage, round: Round, content: string): Promise<void> {
    const ticket = generation;
    const target = await routeTarget(message);
    if (stale(ticket)) return;
    if (!target.ok) {
      await reply(message, round, target.message);
      rounds.complete(round, 'blocked', { response: { reason: 'route-failed' } });
      return;
    }
    const sessionId = target.sessionId;
    if (interactions.questions.has(sessionId)) {
      await reply(message, round, '该会话正在等待回答提问，请用 /answer <验证码> … 作答；普通消息不会被当作答案。');
      rounds.complete(round, 'blocked', { response: { reason: 'question-pending' } });
      return;
    }
    const info = await directory.describe(sessionId);
    round.sessionId = sessionId;
    round.sessionTitle = info.title;
    if (info.workspace) round.workspace = info.workspace;
    // The callback req_id is short-lived: acknowledge before activating the Session.
    await reply(message, round, `已提交到《${oneLine(displayTitle(info.title))}》，本轮完成后会通知你。`);
    if (stale(ticket) || lifetime.signal.aborted || !policy.evaluate(message.chat, message.user).accepted) {
      rounds.complete(round, 'interrupted');
      return;
    }
    const request = {
      requestId: randomUUID(), sessionId, mode: 'queue' as const,
      content: [{ type: 'text' as const, text: content }],
    };
    // Register first: the turn may end before prompt() resolves.
    rounds.awaitTurn(round, request.requestId);
    const startedAt = Date.now();
    const meta = { roundId: round.id, sessionId, requestId: request.requestId, chatId: message.chat, userId: message.user };
    try {
      const response = await ctx.sessionController.prompt(request, lifetime.signal);
      status.count('prompts');
      journal.write({ event: 'dsh.prompt', ...meta, request, response, durationMs: Date.now() - startedAt });
    } catch (error) {
      status.count('failures');
      journal.write({ event: 'dsh.prompt', level: 'warn', ...meta, request, error, durationMs: Date.now() - startedAt });
      rounds.complete(round, 'prompt-failed', { response: { error } });
      if (!stale(ticket)) {
        outbox.enqueue({ chat: message.chat, text: promptFailedNotice(sessionId, info.title), kind: 'prompt-failed', sessionId, roundIds: [round.id] });
      }
    }
  }

  /**
   * Quoting (replying to) one of this Bot's own per-Session notices carries
   * that notice's embedded `/use <token>` hint back on `quotedText`, even
   * though the WeCom callback never echoes the quoted message's id. Only an
   * administrator may act on it: for everyone else the message keeps going to
   * their own Session. An unresolved or missing quote changes nothing.
   */
  async function applyQuotedSession(message: InboundMessage, round: Round): Promise<void> {
    if (!message.quotedText) return;
    const hint = extractSessionPointer(message.quotedText);
    if (!hint) return;
    if (!policy.isAdmin(message.user)) {
      journal.write({
        event: 'wecom.quote', roundId: round.id, chatId: message.chat, userId: message.user,
        hint, outcome: 'not-admin',
      });
      return;
    }
    const resolved = await directory.resolve(hint);
    if (!resolved.ok) {
      journal.write({
        event: 'wecom.quote', level: 'debug', roundId: round.id,
        chatId: message.chat, userId: message.user, hint, outcome: resolved.reason,
      });
      return;
    }
    selection.set(message.chat, message.user, resolved.session.sessionId);
    journal.write({
      event: 'wecom.quote', roundId: round.id, chatId: message.chat, userId: message.user,
      hint, sessionId: resolved.session.sessionId,
    });
  }

  async function handleFrame(frame: WsFrame): Promise<void> {
    if (closed) return;
    const message = parseInbound(frame, settings.botId);
    if (!message) {
      journal.write({ event: 'wecom.message.ignored', level: 'debug', reason: 'invalid-or-foreign-frame', frame });
      return;
    }
    if (!replay.first(message.msgId)) {
      journal.write({ event: 'wecom.message.duplicate', level: 'debug', msgId: message.msgId, chatId: message.chat, userId: message.user });
      return;
    }
    const decision = policy.evaluate(message.chat, message.user);
    observations.record({
      chat: message.chat, user: message.user, chatType: message.chatType,
      decision: decision.accepted ? 'accepted' : 'rejected',
      ...(decision.accepted ? {} : { reason: decision.reason }),
    });
    status.count('received');
    const round = rounds.begin({
      chatId: message.chat, userId: message.user, chatType: message.chatType, msgId: message.msgId,
      reqId: message.reqId, msgtype: message.msgtype, ...(message.text !== undefined ? { text: message.text } : {}),
    });
    journal.write({
      event: 'wecom.message', roundId: round.id,
      chatId: message.chat, userId: message.user, chatType: message.chatType, msgId: message.msgId, msgtype: message.msgtype,
      decision: decision.accepted ? 'accepted' : 'rejected', ...(decision.accepted ? {} : { reason: decision.reason }),
      frame: message.frame,
    });
    if (!decision.accepted) {
      // Never answer a rejected sender: silence does not confirm the Bot's reach.
      status.count('rejected');
      rounds.complete(round, 'rejected', { response: { reason: decision.reason } });
      return;
    }
    observations.markEligible(message.chat, message.user);
    const ticket = generation;
    try {
      // First contact creates the conversation's binding; it decides routing later.
      await router.ensure(parts(message));
    } catch (error) {
      journal.write({ event: 'binding.error', level: 'warn', chatId: message.chat, userId: message.user, error });
      await reply(message, round, '本插件的会话绑定数量已达上限，请在配置页清理后再试。');
      rounds.complete(round, 'blocked', { response: { reason: 'binding-limit' } });
      return;
    }
    if (stale(ticket)) return;
    if (message.msgtype !== 'text') {
      await reply(message, round, '目前只支持文本消息。');
      rounds.complete(round, 'unsupported');
      return;
    }
    const content = message.text?.trim() ?? '';
    if (!content) {
      await reply(message, round, '消息内容为空。');
      rounds.complete(round, 'unsupported');
      return;
    }
    if (byteLength(content) > MAX_INBOUND_BYTES) {
      await reply(message, round, '消息过长，请缩短后再发送。');
      rounds.complete(round, 'blocked', { response: { reason: 'too-long' } });
      return;
    }
    await applyQuotedSession(message, round);
    if (stale(ticket)) return;
    const command = parseCommand(content);
    if (command) {
      round.command = command.name;
      await runCommand(commandServices, { message, round, reply: text => reply(message, round, text) }, command);
      rounds.complete(round, 'command');
      return;
    }
    await submitPrompt(message, round, content);
  }

  async function onTurnEnd(session: SessionHandle, end: SessionEvent, summary: () => TurnSummary): Promise<readonly string[]> {
    if (closed) return [];
    const reason = end.data?.reason?.kind ?? 'unknown';
    // Interrupted or failed turns matter only to someone waiting on them.
    if (reason !== 'completed' && !rounds.hasPending(session.id)) return [];
    const chats = await recipients(session.id, 'turn-complete');
    if (closed || !chats.length) return [];
    const info = await directory.describe(session.id);
    if (closed) return [];
    notify(chats, turnCompleteNotice(summary(), info), 'turn-complete', session.id);
    return chats;
  }

  async function onQuestion(request: QuestionRequest, next: () => Promise<QuestionAnswer>): Promise<QuestionAnswer> {
    const sessionId = request.agent?.id;
    if (closed || !sessionId || !request.questions?.length) return next();
    const chats = await recipients(sessionId, 'question');
    if (closed || !chats.length) return next();
    const info = await directory.describe(sessionId);
    // A text reply cannot represent a plan review or content it never showed:
    // WeCom must not claim these, not even with a free-text answer.
    if (request.questions.some(q => q.intent?.kind === 'plan-review' || Boolean(q.detail))) {
      journal.write({ event: 'dsh.question', sessionId, delegated: 'review', questions: request.questions, chats });
      notify(chats, reviewNotice(sessionId, info.title), 'review', sessionId);
      return next();
    }
    const wait = interactions.waitQuestion(sessionId, request.questions, settings.questionTimeoutMs, request.signal);
    if (!wait) return next();
    journal.write({ event: 'dsh.question', sessionId, nonce: wait.nonce, questions: request.questions, chats, timeoutMs: settings.questionTimeoutMs });
    notify(chats, questionNotice(sessionId, info.title, request.questions, wait.nonce, settings.questionTimeoutMs), 'question', sessionId);
    const answer = await wait.result;
    journal.write({ event: 'dsh.question.result', sessionId, nonce: wait.nonce, outcome: answer ? 'answered' : 'fallback', ...(answer ? { answer } : {}) });
    return answer ?? next();
  }

  async function onApproval(request: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> {
    const sessionId = request.agent?.id;
    if (closed || !sessionId) return next();
    const chats = await recipients(sessionId, 'approval');
    if (closed || !chats.length) return next();
    const info = await directory.describe(sessionId);
    // Only a single chat with an allowlisted person may authorize a tool call;
    // group members never can.
    const privateChats = chats.filter(chat => policy.userAllowed(chat) && isPrivateChat(chat));
    const meta = { sessionId, toolName: request.toolName, ...(request.callId ? { callId: request.callId } : {}) };
    if (!settings.remoteApprovals || !privateChats.length) {
      journal.write({ event: 'dsh.approval', ...meta, remote: false, chats });
      notify(chats, approvalNotice(sessionId, info.title, request), 'approval', sessionId);
      return next();
    }
    const wait = interactions.waitApproval(sessionId, {
      toolName: request.toolName, privateChats, ...(request.callId ? { callId: request.callId } : {}),
    }, settings.questionTimeoutMs, request.signal);
    if (!wait) {
      notify(chats, approvalNotice(sessionId, info.title, request), 'approval', sessionId);
      return next();
    }
    journal.write({ event: 'dsh.approval', ...meta, remote: true, nonce: wait.nonce, chats: privateChats, timeoutMs: settings.questionTimeoutMs });
    notify(privateChats, approvalNotice(sessionId, info.title, request, wait.nonce, settings.questionTimeoutMs), 'approval-request', sessionId);
    const outcome = await wait.result;
    journal.write({ event: 'dsh.approval.result', ...meta, nonce: wait.nonce, outcome: outcome ?? 'fallback' });
    return outcome ?? next();
  }

  function start(): () => void {
    if (closed || started) throw new Error('WeCom bridge cannot be started twice');
    started = true;
    generation++;
    status.set('connecting');
    client.on('connected', () => journal.write({ event: 'wecom.socket', state: 'connected' }));
    client.on('authenticated', () => {
      displaced = false;
      status.set('online');
      outbox.setOnline(true);
    });
    client.on('reconnecting', (attempt: number) => {
      if (!displaced) status.set('reconnecting', `第 ${attempt} 次重连`);
    });
    client.on('disconnected', (reason: string) => {
      outbox.setOnline(false);
      if (!displaced) status.set('offline', scrub(String(reason ?? '')).slice(0, 200) || undefined);
    });
    client.on('error', (error: Error) => {
      outbox.setOnline(false);
      log.warn('WeCom socket error (details in the plugin journal)');
      status.set('error', scrub(error?.message ?? String(error)).slice(0, 200));
    });
    client.on('event.disconnected_event', () => {
      displaced = true;
      outbox.setOnline(false);
      log.warn('WeCom Bot was taken over by another connection; resolve the duplicate before reconnecting');
      status.set('displaced', '同一个 Bot 在别处建立了新连接，本连接已被断开');
    });
    client.on('event', (frame: WsFrame) => journal.write({ event: 'wecom.event', level: 'debug', frame }));
    client.on('message', (frame: WsFrame) => {
      void handleFrame(frame).catch(error => {
        log.error('WeCom callback failed (details in the plugin journal)');
        journal.write({ event: 'bridge.error', level: 'error', stage: 'message', error });
      });
    });
    const offQuestion = ctx.on('user-questions/request', onQuestion);
    const offApproval = ctx.on('approval/request', onApproval);
    const stop = (): void => {
      if (closed) return;
      closed = true;
      generation++;
      lifetime.abort();
      interactions.cancelAll();
      outbox.clear();
      offQuestion?.();
      offApproval?.();
      try { client.disconnect(); } catch { log.warn('WeCom disconnect failed'); }
      try { client.removeAllListeners(); } catch { log.warn('WeCom listener cleanup failed'); }
    };
    try {
      client.connect();
    } catch (error) {
      stop();
      status.set('error', scrub(error instanceof Error ? error.message : String(error)).slice(0, 200));
      throw new Error('WeCom connection failed');
    }
    return stop;
  }

  return { start, handleFrame, onTurnEnd, onQuestion, onApproval, directory, observations, rounds };
}
