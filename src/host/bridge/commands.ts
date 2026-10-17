import type { BindingRecord, GroupRecord } from '../../shared/protocol.js';
import type { SessionController } from '../dsh.js';
import type { Journal } from '../journal.js';
import type { Round } from '../rounds.js';
import type { SessionDirectory } from './directory.js';
import { shortId } from './format.js';
import type { InboundMessage } from './inbound.js';
import { parseAnswer, type InteractionRegistry } from './interactions.js';
import {
  adminOnlyText, code, field, HELP_TEXT, inline, sessionLabel, sessionListText, sessionRef, title,
} from './notices.js';
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

/** Where a sender's plain messages currently go. */
export interface TargetInfo {
  /** Empty when the sender has no Session yet. */
  readonly sessionId?: string;
  readonly binding?: BindingRecord;
  /** Operator note for this sender, whether or not they are a member. */
  readonly note?: string;
  /** The user group this sender belongs to, when they are a member. */
  readonly group?: GroupRecord;
  /** True when an administrator switch is in effect instead of the binding. */
  readonly switched: boolean;
}

export interface CommandServices {
  readonly policy: AccessPolicy;
  readonly directory: SessionDirectory;
  readonly selection: SelectionStore;
  readonly interactions: InteractionRegistry;
  readonly sessionController: SessionController;
  readonly journal: Journal;
  /** The Session this sender talks to right now; never creates one. */
  current(message: InboundMessage): Promise<TargetInfo>;
  /** Give the sender a fresh Session on their own binding. */
  reset(message: InboundMessage): Promise<void>;
  /** True once the bridge stopped or was replaced after `ticket` was taken. */
  stale(ticket: number): boolean;
  ticket(): number;
}

export interface CommandScope {
  readonly message: InboundMessage;
  readonly round: Round;
  reply(text: string): Promise<void>;
}

const BINDING_LABEL = { user: '个人', group: '群聊' } as const;

/**
 * `**🏷 一句话结论**` plus an optional explanation line — the shape every
 * refusal and confirmation in this file uses, so a reply never looks like an
 * undifferentiated wall of text.
 */
function notice(emoji: string, summary: string, detail?: string): string {
  return [title(emoji, summary), ...(detail ? ['', detail] : [])].join('\n');
}

/** `- **标签**：值` — one detail line of a multi-line reply. */
function bullet(label: string, value: string): string {
  return `- ${field(label, value)}`;
}

export async function runCommand(services: CommandServices, scope: CommandScope, command: ParsedCommand): Promise<void> {
  const { message, reply } = scope;
  const { directory, selection, interactions, policy } = services;
  const ticket = services.ticket();
  const current = () => !services.stale(ticket);
  const isAdmin = policy.isAdmin(message.user);

  switch (command.name) {
    case 'help':
    case 'h':
      await reply(HELP_TEXT);
      return;

    case 'whoami': {
      const target = await services.current(message);
      if (!current()) return;
      const lines = [
        title('🪪', '你的身份'),
        '',
        bullet('userid', code(inline(message.user, 120))),
        message.chatType === 'group'
          ? bullet('当前群聊', code(inline(message.chat, 120)))
          : bullet('当前会话', '单聊（chatid 即你的 userid）'),
        bullet('管理员', isAdmin ? '是' : '否'),
      ];
      if (target.group) lines.push(bullet('分组', inline(target.group.name, 60)));
      if (target.binding) {
        lines.push(bullet('绑定', `${BINDING_LABEL[target.binding.kind]} ${code(inline(target.binding.id, 120))}`));
      }
      lines.push(
        '',
        isAdmin
          ? '你是本插件的管理员：可以切换会话，并按 Workspace 接收通知。'
          : `你不是本插件的管理员：消息只会进入你自己的专属会话，如需新的会话请发送 ${code('/new')}。`,
        '',
        '分组、Workspace 与模型都可以在 DSH 的插件主页里查看和调整。',
      );
      await reply(lines.join('\n'));
      return;
    }

    case 'status': {
      const target = await services.current(message);
      const info = target.sessionId ? await directory.describe(target.sessionId) : undefined;
      if (!current()) return;
      const questions = [...interactions.questions.values()].filter(q => q.sessionId === target.sessionId).length;
      const approvals = [...interactions.approvals.values()].filter(a => a.privateChats.has(message.chat)).length;
      const lines = [
        title('🧭', '当前状态'),
        '',
        target.sessionId
          ? bullet('会话', sessionRef(info?.title, target.sessionId))
          : bullet('会话', '尚未创建（发送任意消息即会自动创建）'),
        ...(info?.workspace ? [bullet('Workspace', inline(info.workspace, 120))] : []),
        ...(info?.model ? [bullet('模型', code(`${info.model.provider}/${info.model.model}`))] : []),
      ];
      if (target.group) lines.push(bullet('分组', inline(target.group.name, 60)));
      if (target.binding) {
        const note = target.note ? `（${inline(target.note, 40)}）` : '';
        lines.push(bullet('绑定', `${BINDING_LABEL[target.binding.kind]} ${code(inline(target.binding.id, 120))}${note}`));
      }
      lines.push(bullet('待处理', `${questions} 个提问 · ${approvals} 个审批`));
      if (target.switched) {
        lines.push('', `> 管理员切换中：你现在操作的不是自己的专属会话。发送 ${code('/reset')} 可以回到自己的会话。`);
      }
      await reply(lines.join('\n'));
      return;
    }

    case 'new':
    case 'reset-self': {
      await services.reset(message);
      if (!current()) return;
      await reply([
        title('🌱', '已换用新的专属会话'),
        '',
        '下一条消息会在一个全新的 DSH 会话里开始；旧会话仍然保留在 DSH 中。',
      ].join('\n'));
      return;
    }

    case 'sessions':
    case 'list':
    case 'ls': {
      if (!isAdmin) { await reply(adminOnlyText()); return; }
      try {
        const groups = await directory.groups();
        if (!current()) return;
        const target = await services.current(message);
        const { text, listing } = sessionListText(groups, target.sessionId);
        selection.setListing(message.chat, message.user, listing);
        await reply(text);
      } catch {
        if (current()) await reply(notice('⚠️', '读取 DSH 会话列表失败', '请稍后重试，或到 DSH 页面查看。'));
      }
      return;
    }

    case 'use': {
      if (!isAdmin) { await reply(adminOnlyText()); return; }
      const token = command.args[0];
      if (!token) {
        await reply(notice('ℹ️', '用法', `${code('/use 序号')} 或 ${code('/use 会话ID前缀')}；先发送 ${code('/sessions')} 查看序号。`));
        return;
      }
      const result = await directory.resolve(token, selection.listing(message.chat, message.user));
      if (!current()) return;
      if (!result.ok) {
        const text = result.reason === 'ambiguous' ? notice('⚠️', '匹配到多个会话', '请提供更长的会话 ID 前缀。')
          : result.reason === 'unavailable' ? notice('⚠️', '暂时无法读取 DSH 会话列表', '请稍后重试。')
          : result.reason === 'forbidden' ? notice('🔒', '该会话不在你的 Workspace 范围内', '请让管理员调整管理员 Workspace 设置。')
          : result.hidden === 'archived' ? notice('⚠️', '该会话已归档', '归档的会话不能从企业微信操作。')
          : result.hidden ? notice('⚠️', '该会话当前不可操作')
          : notice('⚠️', '找不到该会话', `发送 ${code('/sessions')} 查看可切换的会话。`);
        await reply(text);
        return;
      }
      selection.set(message.chat, message.user, result.session.sessionId);
      services.journal.write({ event: 'wecom.selection', roundId: scope.round.id, chatId: message.chat, userId: message.user, sessionId: result.session.sessionId });
      await reply([
        title('🔄', `已切换到${sessionLabel(result.session.title)}`),
        '',
        bullet('Workspace', inline(result.session.workspace, 120)),
        bullet('会话 ID', code(shortId(result.session.sessionId))),
        '',
        `现在直接发送消息即可继续该会话；发送 ${code('/reset')} 可以回到自己的专属会话。`,
      ].join('\n'));
      return;
    }

    case 'reset': {
      if (!isAdmin) { await reply(adminOnlyText()); return; }
      selection.clear(message.chat, message.user);
      if (!current()) return;
      const target = await services.current(message);
      if (!target.sessionId) {
        await reply(notice('↩️', '已放弃切换', '你还没有专属会话，发送任意消息即可创建。'));
        return;
      }
      const info = await directory.describe(target.sessionId);
      if (!current()) return;
      await reply(`${title('↩️', '已放弃切换')} · 回到你自己的专属会话${sessionLabel(info.title)}`);
      return;
    }

    case 'cancel': {
      const target = await services.current(message);
      if (!target.sessionId) { await reply(notice('ℹ️', '你还没有专属会话', '发送任意消息即可创建。')); return; }
      if (!(await directory.permitted(target.sessionId))) {
        // A bound Session may live outside the administrator scope; cancelling
        // it is still the owner's business, so only a switched-to Session is refused here.
        if (target.switched) { if (current()) await reply(notice('⚠️', '该会话当前不可操作')); return; }
      }
      if (!current()) return;
      try {
        services.sessionController.cancel({ sessionId: target.sessionId });
        services.journal.write({ event: 'dsh.cancel', roundId: scope.round.id, sessionId: target.sessionId, chatId: message.chat, userId: message.user });
        await reply(`${title('🛑', '已请求停止当前回合')} · ${code(shortId(target.sessionId))}`);
      } catch (error) {
        services.journal.write({ event: 'dsh.cancel', level: 'warn', roundId: scope.round.id, sessionId: target.sessionId, error });
        await reply(notice('🛑', '没有可停止的回合', '该会话当前没有正在运行的回合。'));
      }
      return;
    }

    case 'answer': {
      const state = command.args[0] ? interactions.findQuestion(command.args[0]) : undefined;
      if (!state) {
        await reply(notice('⚠️', '没有对应的待回答提问', '验证码可能无效或已经过期。'));
        return;
      }
      let question = state.questions.length === 1 ? state.questions[0] : undefined;
      let answer = textAfterTokens(command.rest, 1);
      if (question && command.args[1] === question.id && command.args.length > 2) answer = textAfterTokens(command.rest, 2);
      if (state.questions.length > 1) {
        question = state.questions.find(q => q.id === command.args[1]);
        answer = textAfterTokens(command.rest, 2);
      }
      if (!question) {
        await reply(notice('⚠️', '请指明题目 ID', state.questions.map(q => code(inline(q.id, 60))).join('、')));
        return;
      }
      const parsed = parseAnswer(question, answer);
      if (!parsed.ok) {
        await reply(notice('⚠️', parsed.error, `格式：${code('/answer 验证码 选项序号或文字')}`));
        return;
      }
      state.answers.set(question.id, parsed.item);
      const remaining = state.questions.filter(q => !state.answers.has(q.id));
      services.journal.write({ event: 'dsh.question.answer', roundId: scope.round.id, sessionId: state.sessionId, questionId: question.id, answer: parsed.item, remaining: remaining.length });
      if (!remaining.length) state.finish({ answers: state.questions.map(q => state.answers.get(q.id)!) });
      await reply(remaining.length
        ? `${title('📝', '已记录')} · 还需回答：${remaining.map(q => inline(q.id, 60)).join('、')}`
        : title('✅', '答案已提交给 DSH'));
      return;
    }

    case 'approve':
    case 'deny': {
      const state = command.args[0] ? interactions.findApproval(command.args[0]) : undefined;
      // Tool execution may only be authorized by an allowlisted person in a single chat.
      if (!state || command.args.length !== 1 || message.chatType !== 'single' || message.chat !== message.user
        || !state.privateChats.has(message.chat)) {
        await reply(notice('⚠️', '没有可在此单聊审批的请求', '验证码可能无效或已经过期。'));
        return;
      }
      const outcome = command.name === 'approve' ? 'allowed-once' : 'rejected';
      services.journal.write({ event: 'dsh.approval.answer', roundId: scope.round.id, sessionId: state.sessionId, toolName: state.toolName, callId: state.callId, outcome });
      state.finish(outcome);
      await reply(title(outcome === 'allowed-once' ? '✅' : '🚫', outcome === 'allowed-once' ? '已允许本次工具调用' : '已拒绝本次工具调用'));
      return;
    }

    default:
      await reply(`${title('❓', '未知命令')} · 发送 ${code('/help')} 查看可用命令。`);
  }
}
