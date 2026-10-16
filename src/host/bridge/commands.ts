import type { SessionController } from '../dsh.js';
import type { Journal } from '../journal.js';
import type { Round } from '../rounds.js';
import type { SessionDirectory } from './directory.js';
import { displayTitle, oneLine, shortId } from './format.js';
import type { InboundMessage } from './inbound.js';
import { parseAnswer, type InteractionRegistry } from './interactions.js';
import { HELP_TEXT, sessionListText } from './notices.js';
import type { AccessPolicy } from './policy.js';
import type { SelectionStore } from './selection.js';

/** Slash commands sent from WeCom. Every handler answers with one passive reply. */

export interface ParsedCommand {
  readonly name: string;
  readonly args: readonly string[];
  /** Text after the command word, original spacing preserved. */
  readonly rest: string;
}

export function parseCommand(text: string): ParsedCommand | undefined {
  const trimmed = text.trim();
  const match = /^\/([A-Za-z]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return undefined;
  const rest = (match[2] ?? '').trim();
  return { name: match[1]!.toLowerCase(), args: rest ? rest.split(/\s+/) : [], rest };
}

/** Drop `count` whitespace-separated tokens and return the remaining text verbatim. */
export function textAfterTokens(text: string, count: number): string {
  let rest = text.trim();
  for (let i = 0; i < count; i++) rest = rest.replace(/^\S+\s*/, '');
  return rest.trim();
}

export interface CommandServices {
  readonly policy: AccessPolicy;
  readonly directory: SessionDirectory;
  readonly selection: SelectionStore;
  readonly interactions: InteractionRegistry;
  readonly sessionController: SessionController;
  readonly journal: Journal;
  /** The Session plain messages from this sender currently go to. */
  target(message: InboundMessage): string | undefined;
  /** True once the bridge stopped or was replaced after `ticket` was taken. */
  stale(ticket: number): boolean;
  ticket(): number;
}

export interface CommandScope {
  readonly message: InboundMessage;
  readonly round: Round;
  reply(text: string): Promise<void>;
}

export async function runCommand(services: CommandServices, scope: CommandScope, command: ParsedCommand): Promise<void> {
  const { message, reply } = scope;
  const { directory, selection, interactions, policy } = services;
  const ticket = services.ticket();
  const current = () => !services.stale(ticket);

  switch (command.name) {
    case 'help':
    case 'h':
      await reply(HELP_TEXT);
      return;

    case 'whoami':
      await reply([
        `你的 userid：${message.user}`,
        message.chatType === 'group' ? `当前群聊 chatid：${message.chat}` : `当前为单聊（会话 ID 即你的 userid）`,
        '可在 DSH 插件主页把这些 ID 加入白名单。',
      ].join('\n'));
      return;

    case 'sessions':
    case 'list':
    case 'ls': {
      try {
        const groups = await directory.groups();
        if (!current()) return;
        const { text, listing } = sessionListText(groups, services.target(message));
        selection.setListing(message.chat, message.user, listing);
        await reply(text);
      } catch {
        if (current()) await reply('读取 DSH 会话列表失败，请稍后重试或到 DSH 页面查看。');
      }
      return;
    }

    case 'use': {
      const token = command.args[0];
      if (!token) { await reply('用法：/use <序号|会话ID前缀>。先发送 /sessions 查看序号。'); return; }
      const result = await directory.resolve(token, selection.listing(message.chat, message.user));
      if (!current()) return;
      if (!result.ok) {
        const text = result.reason === 'ambiguous' ? '匹配到多个会话，请提供更长的会话 ID 前缀。'
          : result.reason === 'unavailable' ? '暂时无法读取 DSH 会话列表，请稍后重试。'
          : result.reason === 'forbidden' ? '该会话不在插件允许的 Session 范围内。'
          : result.hidden === 'archived' ? '该会话已归档，不能从企业微信操作。'
          : result.hidden ? '该会话当前不可操作。'
          : '找不到该会话。发送 /sessions 查看可操作的会话。';
        await reply(text);
        return;
      }
      selection.set(message.chat, message.user, result.session.sessionId);
      services.journal.write({ event: 'wecom.selection', roundId: scope.round.id, chatId: message.chat, userId: message.user, sessionId: result.session.sessionId });
      await reply(`已选择《${oneLine(displayTitle(result.session.title))}》（${oneLine(result.session.workspace)} · ${shortId(result.session.sessionId)}）。\n现在直接发送消息即可继续该会话。`);
      return;
    }

    case 'status': {
      const target = services.target(message);
      const info = target ? await directory.describe(target) : undefined;
      if (!current()) return;
      const questions = [...interactions.questions.values()].filter(q => policy.sessionListed(q.sessionId)).length;
      const approvals = [...interactions.approvals.values()].filter(a => a.privateChats.has(message.chat)).length;
      await reply([
        target ? `当前会话：《${oneLine(displayTitle(info?.title))}》${info?.workspace ? `（${oneLine(info.workspace)}）` : ''} ${shortId(target)}` : '当前会话：未选择（发送 /sessions 后用 /use 选择）',
        `待回答提问：${questions} 个；可在此审批的请求：${approvals} 个`,
      ].join('\n'));
      return;
    }

    case 'cancel': {
      const target = services.target(message);
      if (!target) { await reply('请先用 /use 选择会话。'); return; }
      if (!(await directory.permitted(target))) { if (current()) await reply('该会话当前不可操作。'); return; }
      if (!current()) return;
      try {
        services.sessionController.cancel({ sessionId: target });
        services.journal.write({ event: 'dsh.cancel', roundId: scope.round.id, sessionId: target, chatId: message.chat, userId: message.user });
        await reply(`已请求停止 ${shortId(target)} 的当前回合。`);
      } catch (error) {
        services.journal.write({ event: 'dsh.cancel', level: 'warn', roundId: scope.round.id, sessionId: target, error });
        await reply('该会话当前没有可停止的回合。');
      }
      return;
    }

    case 'answer': {
      const state = command.args[0] ? interactions.findQuestion(command.args[0]) : undefined;
      if (!state || !policy.sessionListed(state.sessionId)) {
        await reply('没有对应的待回答提问，或验证码无效/已过期。');
        return;
      }
      let question = state.questions.length === 1 ? state.questions[0] : undefined;
      let answer = textAfterTokens(command.rest, 1);
      if (question && command.args[1] === question.id && command.args.length > 2) answer = textAfterTokens(command.rest, 2);
      if (state.questions.length > 1) {
        question = state.questions.find(q => q.id === command.args[1]);
        answer = textAfterTokens(command.rest, 2);
      }
      if (!question) { await reply(`请指明题目 ID：${state.questions.map(q => q.id).join('、')}`); return; }
      const parsed = parseAnswer(question, answer);
      if (!parsed.ok) { await reply(parsed.error); return; }
      state.answers.set(question.id, parsed.item);
      const remaining = state.questions.filter(q => !state.answers.has(q.id));
      services.journal.write({ event: 'dsh.question.answer', roundId: scope.round.id, sessionId: state.sessionId, questionId: question.id, answer: parsed.item, remaining: remaining.length });
      if (!remaining.length) state.finish({ answers: state.questions.map(q => state.answers.get(q.id)!) });
      await reply(remaining.length ? `已记录，还需回答：${remaining.map(q => q.id).join('、')}` : '答案已提交给 DSH。');
      return;
    }

    case 'approve':
    case 'deny': {
      const state = command.args[0] ? interactions.findApproval(command.args[0]) : undefined;
      // Tool execution may only be authorized by an allowlisted person in a single chat.
      if (!state || command.args.length !== 1 || message.chatType !== 'single' || message.chat !== message.user
        || !state.privateChats.has(message.chat)) {
        await reply('没有可在此单聊审批的请求，或验证码无效/已过期。');
        return;
      }
      const outcome = command.name === 'approve' ? 'allowed-once' : 'rejected';
      services.journal.write({ event: 'dsh.approval.answer', roundId: scope.round.id, sessionId: state.sessionId, toolName: state.toolName, callId: state.callId, outcome });
      state.finish(outcome);
      await reply(outcome === 'allowed-once' ? '已允许本次工具调用。' : '已拒绝本次工具调用。');
      return;
    }

    default:
      await reply('未知命令，发送 /help 查看可用命令。');
  }
}
