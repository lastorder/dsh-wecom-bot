import { randomUUID } from 'node:crypto';
import { createCatalogService } from '../catalog.js';
import { nullJournal } from '../journal.js';
import { createObservationStore } from '../observation.js';
import { createRoundTracker } from '../rounds.js';
import { createStatusTracker } from '../status.js';
import { parseCommand, runCommand } from './commands.js';
import { createSessionDirectory } from './directory.js';
import { byteLength, limitBytes, MAX_INBOUND_BYTES, MAX_REPLY_BYTES, displayTitle, extractSessionPointer, oneLine } from './format.js';
import { createReplayGuard, parseInbound } from './inbound.js';
import { createInteractionRegistry } from './interactions.js';
import { approvalNotice, promptFailedNotice, questionNotice, reviewNotice, sessionListText, turnCompleteNotice, } from './notices.js';
import { ackSummary, createOutbox } from './outbox.js';
import { createAccessPolicy } from './policy.js';
import { createSelectionStore } from './selection.js';
export function createBridge(deps) {
    const { ctx, client, settings } = deps;
    const log = deps.log ?? console;
    const journal = deps.journal ?? nullJournal;
    const observations = deps.observations ?? createObservationStore();
    const rounds = deps.rounds ?? createRoundTracker({ journal });
    const status = deps.status ?? createStatusTracker(journal);
    const scrub = deps.scrub ?? ((text) => text);
    const catalogs = deps.catalogs ?? createCatalogService({
        list: async (signal) => (await ctx.sessionController.list({}, signal)).items,
        registry: () => undefined,
    });
    const policy = createAccessPolicy(settings);
    const directory = createSessionDirectory(catalogs, policy);
    const selection = createSelectionStore();
    const interactions = createInteractionRegistry();
    const outbox = createOutbox({ client, journal, log, status });
    const replay = createReplayGuard();
    const lifetime = new AbortController();
    let closed = false;
    let started = false;
    let displaced = false;
    let generation = 0;
    const stale = (ticket) => closed || ticket !== generation;
    function target(message) {
        const choice = selection.get(message.chat, message.user);
        if (choice && policy.sessionListed(choice))
            return choice;
        return policy.sessionIds.size === 1 ? [...policy.sessionIds][0] : undefined;
    }
    /**
     * Quoting (replying to) one of this Bot's own per-Session notices carries
     * that notice's embedded `/use <token>` hint back on `quotedText`, even
     * though the WeCom callback never echoes the quoted message's id. When
     * the token resolves to an operable Session, this message (and any
     * command inside it: `/status`, `/cancel`, a plain reply, …) is routed
     * there — overriding whatever was selected before, exactly as `/use`
     * would. An unresolved or missing quote changes nothing.
     */
    async function applyQuotedSession(message, round) {
        if (!message.quotedText)
            return;
        const hint = extractSessionPointer(message.quotedText);
        if (!hint)
            return;
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
    /**
     * Conversations that may receive automatic messages about this Session.
     * `reason` only labels the {@link journal} warning emitted when the
     * Session is allowed to notify but nobody currently qualifies — typically
     * because the eligible-sender list was just reset (a plugin reload or a
     * Host restart both clear it) and nobody has messaged this Bot since. The
     * caller then has nothing to notify and no error to show either, so this
     * is the only trace of a silently skipped notification.
     */
    async function recipients(sessionId, reason) {
        if (!(await directory.permitted(sessionId)))
            return [];
        if (policy.chatIds.size)
            return [...policy.chatIds];
        // "Any conversation" still means only conversations that passed the
        // policy before: a rejected sender never starts receiving notifications.
        const chats = observations.eligibleSources()
            .filter(source => policy.chatAllowed(source.chat) && policy.userAllowed(source.user))
            .map(source => source.chat);
        const unique = [...new Set(chats)];
        if (!unique.length) {
            journal.write({
                event: 'wecom.notify.skipped', level: 'warn', sessionId, reason,
                detail: 'no eligible WeCom recipient knows this Session; a plugin reload or Host restart just cleared that list and nobody has messaged this Bot since',
            });
        }
        return unique;
    }
    function notify(chats, text, kind, sessionId) {
        for (const chat of chats)
            outbox.enqueue({ chat, text, kind, ...(sessionId ? { sessionId } : {}) });
    }
    async function reply(message, round, text) {
        if (closed)
            return;
        const content = limitBytes(text, MAX_REPLY_BYTES);
        const streamId = `stream_${randomUUID()}`;
        rounds.reply(round, content);
        const startedAt = Date.now();
        const meta = { roundId: round.id, chatId: message.chat, userId: message.user, reqId: message.reqId };
        try {
            const ack = await client.replyStream(message.frame, streamId, content, true);
            journal.write({ event: 'wecom.reply', ...meta, request: { streamId, content, finish: true }, response: ackSummary(ack), durationMs: Date.now() - startedAt });
        }
        catch (error) {
            status.count('failures');
            log.warn('WeCom reply failed');
            journal.write({ event: 'wecom.reply', level: 'warn', ...meta, request: { streamId, content, finish: true }, error, durationMs: Date.now() - startedAt });
        }
    }
    const commandServices = {
        policy, directory, selection, interactions, journal,
        sessionController: ctx.sessionController,
        target,
        stale,
        ticket: () => generation,
    };
    async function submitPrompt(message, round, content) {
        const ticket = generation;
        const sessionId = target(message);
        if (!sessionId) {
            let text = '还没有选择会话。';
            try {
                const listed = sessionListText(await directory.groups(), undefined);
                selection.setListing(message.chat, message.user, listed.listing);
                text = `${text}\n${listed.text}`;
            }
            catch {
                text = `${text}发送 /sessions 查看可操作的会话，再用 /use 选择。`;
            }
            if (stale(ticket))
                return;
            await reply(message, round, text);
            rounds.complete(round, 'blocked', { response: { reason: 'no-session-selected' } });
            return;
        }
        if (interactions.questions.has(sessionId)) {
            await reply(message, round, '该会话正在等待回答提问，请用 /answer <验证码> … 作答；普通消息不会被当作答案。');
            rounds.complete(round, 'blocked', { response: { reason: 'question-pending' } });
            return;
        }
        const permitted = await directory.permitted(sessionId);
        if (stale(ticket))
            return;
        if (!permitted) {
            await reply(message, round, '当前选择的会话已归档或不再允许操作，请发送 /sessions 重新选择。');
            rounds.complete(round, 'blocked', { response: { reason: 'session-not-permitted' } });
            return;
        }
        const info = await directory.describe(sessionId);
        round.sessionId = sessionId;
        round.sessionTitle = info.title;
        if (info.workspace)
            round.workspace = info.workspace;
        // The callback req_id is short-lived: acknowledge before activating the Session.
        await reply(message, round, `已提交到《${oneLine(displayTitle(info.title))}》，本轮完成后会通知你。`);
        if (stale(ticket) || lifetime.signal.aborted || !policy.evaluate(message.chat, message.user).accepted
            || target(message) !== sessionId) {
            rounds.complete(round, 'interrupted');
            return;
        }
        const request = {
            requestId: randomUUID(), sessionId, mode: 'queue',
            content: [{ type: 'text', text: content }],
        };
        // Register first: the turn may end before prompt() resolves.
        rounds.awaitTurn(round, request.requestId);
        const startedAt = Date.now();
        const meta = { roundId: round.id, sessionId, requestId: request.requestId, chatId: message.chat, userId: message.user };
        try {
            const response = await ctx.sessionController.prompt(request, lifetime.signal);
            status.count('prompts');
            journal.write({ event: 'dsh.prompt', ...meta, request, response, durationMs: Date.now() - startedAt });
        }
        catch (error) {
            status.count('failures');
            journal.write({ event: 'dsh.prompt', level: 'warn', ...meta, request, error, durationMs: Date.now() - startedAt });
            rounds.complete(round, 'prompt-failed', { response: { error } });
            if (!stale(ticket)) {
                outbox.enqueue({ chat: message.chat, text: promptFailedNotice(sessionId, info.title), kind: 'prompt-failed', sessionId, roundIds: [round.id] });
            }
        }
    }
    async function handleFrame(frame) {
        if (closed)
            return;
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
        const command = parseCommand(content);
        if (command) {
            round.command = command.name;
            await runCommand(commandServices, { message, round, reply: text => reply(message, round, text) }, command);
            rounds.complete(round, 'command');
            return;
        }
        await submitPrompt(message, round, content);
    }
    async function onTurnEnd(session, end, summary) {
        if (closed)
            return [];
        const reason = end.data?.reason?.kind ?? 'unknown';
        // Interrupted or failed turns matter only to someone waiting on them.
        if (reason !== 'completed' && !rounds.hasPending(session.id))
            return [];
        const chats = await recipients(session.id, 'turn-complete');
        if (closed || !chats.length)
            return [];
        const info = await directory.describe(session.id);
        if (closed)
            return [];
        notify(chats, turnCompleteNotice(summary(), info), 'turn-complete', session.id);
        return chats;
    }
    async function onQuestion(request, next) {
        const sessionId = request.agent?.id;
        if (closed || !sessionId || !request.questions?.length)
            return next();
        const chats = await recipients(sessionId, 'question');
        if (closed || !chats.length)
            return next();
        const info = await directory.describe(sessionId);
        // A text reply cannot represent a plan review or content it never showed:
        // WeCom must not claim these, not even with a free-text answer.
        if (request.questions.some(q => q.intent?.kind === 'plan-review' || Boolean(q.detail))) {
            journal.write({ event: 'dsh.question', sessionId, delegated: 'review', questions: request.questions, chats });
            notify(chats, reviewNotice(sessionId, info.title), 'review', sessionId);
            return next();
        }
        const wait = interactions.waitQuestion(sessionId, request.questions, settings.questionTimeoutMs, request.signal);
        if (!wait)
            return next();
        journal.write({ event: 'dsh.question', sessionId, nonce: wait.nonce, questions: request.questions, chats, timeoutMs: settings.questionTimeoutMs });
        notify(chats, questionNotice(sessionId, info.title, request.questions, wait.nonce, settings.questionTimeoutMs), 'question', sessionId);
        const answer = await wait.result;
        journal.write({ event: 'dsh.question.result', sessionId, nonce: wait.nonce, outcome: answer ? 'answered' : 'fallback', ...(answer ? { answer } : {}) });
        return answer ?? next();
    }
    async function onApproval(request, next) {
        const sessionId = request.agent?.id;
        if (closed || !sessionId)
            return next();
        const chats = await recipients(sessionId, 'approval');
        if (closed || !chats.length)
            return next();
        const info = await directory.describe(sessionId);
        // Only a single chat with an allowlisted (or previously accepted) person
        // may authorize a tool call; group members never can.
        const eligible = observations.eligibleSources();
        const privateChats = chats.filter(chat => policy.userAllowed(chat)
            && (policy.userIds.has(chat) || eligible.some(source => source.chat === chat && source.user === chat)));
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
    function start() {
        if (closed || started)
            throw new Error('WeCom bridge cannot be started twice');
        started = true;
        generation++;
        status.set('connecting');
        client.on('connected', () => journal.write({ event: 'wecom.socket', state: 'connected' }));
        client.on('authenticated', () => {
            displaced = false;
            status.set('online');
            outbox.setOnline(true);
        });
        client.on('reconnecting', (attempt) => {
            if (!displaced)
                status.set('reconnecting', `第 ${attempt} 次重连`);
        });
        client.on('disconnected', (reason) => {
            outbox.setOnline(false);
            if (!displaced)
                status.set('offline', scrub(String(reason ?? '')).slice(0, 200) || undefined);
        });
        client.on('error', (error) => {
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
        client.on('event', (frame) => journal.write({ event: 'wecom.event', level: 'debug', frame }));
        client.on('message', (frame) => {
            void handleFrame(frame).catch(error => {
                log.error('WeCom callback failed (details in the plugin journal)');
                journal.write({ event: 'bridge.error', level: 'error', stage: 'message', error });
            });
        });
        const offQuestion = ctx.on('user-questions/request', onQuestion);
        const offApproval = ctx.on('approval/request', onApproval);
        const stop = () => {
            if (closed)
                return;
            closed = true;
            generation++;
            lifetime.abort();
            interactions.cancelAll();
            outbox.clear();
            offQuestion?.();
            offApproval?.();
            try {
                client.disconnect();
            }
            catch {
                log.warn('WeCom disconnect failed');
            }
            try {
                client.removeAllListeners();
            }
            catch {
                log.warn('WeCom listener cleanup failed');
            }
        };
        try {
            client.connect();
        }
        catch (error) {
            stop();
            status.set('error', scrub(error instanceof Error ? error.message : String(error)).slice(0, 200));
            throw new Error('WeCom connection failed');
        }
        return stop;
    }
    return { start, handleFrame, onTurnEnd, onQuestion, onApproval, directory, observations, rounds };
}
//# sourceMappingURL=index.js.map