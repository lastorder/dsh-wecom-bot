import type { TemplateCard } from '@wecom/aibot-node-sdk';
import type { BindingRecord, GroupRecord, WorkspaceOption } from '../../shared/protocol.js';
import type { SessionController } from '../dsh.js';
import type { Journal } from '../journal.js';
import type { Round } from '../rounds.js';
import type { SessionOperations } from '../session-ops.js';
import type { WorkspaceService } from '../workspaces.js';
import { PICKER_LIST_LIMIT, type AdminActionRegistry } from './admin-actions.js';
import type { OperableGroup, ResolveResult, SessionDirectory } from './directory.js';
import { formatContext, shortId } from './format.js';
import type { InboundMessage } from './inbound.js';
import { parseAnswer, type InteractionRegistry } from './interactions.js';
import {
  adminOnlyText, adminPrivateOnlyText, adminUnassignedText, code, compactedText, currentSessionText, deleteWarningText, deletedText, field,
  groupSessionRefusalText, HELP_TEXT, inline, interactionIgnoredText, interactionSubmittedText, newSessionText, nothingToCompactText,
  pickerSummaryText, questionAccessRefusalText, retiredCommandText, sessionLabel, sessionPickerCard, sessionPickerText, sessionRef,
  sessionSwitchedText, title, workspacePickerCard, workspacePickerText,
} from './notices.js';
import type { AccessPolicy } from './policy.js';
import { sessionTitleFor } from '../session-title.js';
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

/** The administrator preference the Bot itself writes (`/new`). */
export interface AdminWorkspaceStore {
  adminWorkspace(user: string): string;
  setAdminWorkspace(user: string, path: string): Promise<void>;
}

export interface OperationTicket {
  readonly bridge: number;
  readonly chat: string;
  readonly routing: number;
}

export interface CommandServices {
  readonly policy: AccessPolicy;
  readonly directory: SessionDirectory;
  readonly selection: SelectionStore;
  readonly interactions: InteractionRegistry;
  /** Pending `/new` and `/session` picker cards, answered from WeCom. */
  readonly adminActions: AdminActionRegistry;
  readonly sessionController: SessionController;
  readonly journal: Journal;
  /** DSH operations the Bot exposes: archive, compact, create. */
  readonly ops: SessionOperations;
  readonly workspaces: WorkspaceService;
  readonly adminWorkspaces: AdminWorkspaceStore;
  /** The Session this sender talks to right now; never creates one. */
  current(message: InboundMessage): Promise<TargetInfo>;
  /** Archive `sessionId` and stop pointing any member at it. */
  archiveSession(message: InboundMessage, sessionId: string): Promise<void>;
  /** True once the bridge stopped or was replaced after `ticket` was taken. */
  stale(ticket: OperationTicket): boolean;
  ticket(message: InboundMessage): OperationTicket;
}

export interface CommandScope {
  readonly message: InboundMessage;
  readonly round: Round;
  reply(text: string): Promise<void>;
  /**
   * Answer the command with picker card(s): the first page is the passive
   * reply itself (one WeCom message), further pages follow proactively. `text`
   * is the numbered fallback, sent only if the card cannot be delivered.
   */
  replyCards(text: string, cards: readonly TemplateCard[]): Promise<void>;
}

const BINDING_LABEL = { user: '个人', group: '群聊' } as const;

/**
 * Commands only an administrator may ever run. They act on the Bot rather than
 * on this chat's conversation, so a group chat refuses them even for an
 * administrator: the Session there is shared, and it must not be created,
 * switched or re-pointed — or its tool calls approved — from the group.
 */
const ADMIN_ONLY_COMMANDS = new Set(['new', 'session', 'reset', 'approve', 'deny']);

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

/** The Workspace a command should default to for one administrator. */
function preferredWorkspace(services: CommandServices, user: string): string {
  return services.adminWorkspaces.adminWorkspace(user);
}

/** Title of one Workspace path, falling back to the path itself. */
async function workspaceTitle(services: CommandServices, path: string): Promise<string> {
  if (!path) {
    try {
      return (await services.workspaces.describe('')).title;
    } catch {
      return '插件默认 Workspace';
    }
  }
  const listed = services.workspaces.list().find(workspace => workspace.path === path);
  return listed?.title ?? path;
}

/** Workspaces the administrator's notification/operation scope actually covers. */
function allowedWorkspaces(services: CommandServices): WorkspaceOption[] {
  return services.workspaces.list().filter(workspace => services.policy.adminWorkspaceAllowed(workspace.path));
}

/**
 * Create a Session in a Workspace and make it the administrator's current one.
 *
 * The caller passes `current()`: if an operator edit replaced the bridge, or a
 * routing change invalidated this chat while DSH was creating the Session, the
 * new Session must not become a switch. `undefined` says exactly that.
 */
export async function createSessionForAdmin(
  services: CommandServices,
  input: { readonly chat: string; readonly user: string; readonly workspace: string; readonly roundId?: string },
  current: () => boolean = () => true,
): Promise<{ readonly sessionId: string; readonly workspaceTitle: string } | undefined> {
  const created = await services.ops.create({ workspace: input.workspace, title: sessionTitleFor(input.user) });
  if (!current()) return undefined;
  services.selection.set(input.chat, input.user, created.sessionId);
  try {
    await services.adminWorkspaces.setAdminWorkspace(input.user, input.workspace);
  } catch (error) {
    // The Session exists and is switched; only the remembered default failed.
    services.journal.write({
      event: 'wecom.workspace.select', level: 'warn', chatId: input.chat,
      userId: input.user, workspace: input.workspace, error,
    });
  }
  const title = await workspaceTitle(services, input.workspace);
  services.journal.write({
    event: 'wecom.session.new', ...(input.roundId ? { roundId: input.roundId } : {}),
    chatId: input.chat, userId: input.user, sessionId: created.sessionId, workspace: input.workspace,
  });
  return { sessionId: created.sessionId, workspaceTitle: title };
}

/**
 * Point an administrator at one Session. Re-checks the live Workspace scope, so
 * a card sent before a scope edit cannot move them afterwards.
 */
export async function switchSessionForAdmin(
  services: CommandServices,
  input: { readonly chat: string; readonly user: string; readonly sessionId: string; readonly roundId?: string },
  current: () => boolean = () => true,
): Promise<boolean> {
  const permitted = await services.directory.permitted(input.sessionId);
  if (!current() || !permitted) return false;
  services.selection.set(input.chat, input.user, input.sessionId);
  services.journal.write({
    event: 'wecom.selection', ...(input.roundId ? { roundId: input.roundId } : {}),
    chatId: input.chat, userId: input.user, sessionId: input.sessionId,
  });
  return true;
}

/**
 * The Workspace picker for `/new` or `/session`: one card per page, with the
 * numbered text built only as the card's fallback. No Workspace means no card —
 * the text explains why.
 */
function workspacePickerStage(
  services: CommandServices,
  chat: string,
  user: string,
  purpose: 'new' | 'session',
  workspaces: readonly WorkspaceOption[],
  currentPath: string,
  currentSessionId?: string,
  summary?: string,
): { readonly text: string; readonly cards: readonly TemplateCard[] } {
  const text = workspacePickerText(purpose, workspaces, currentPath);
  // The text lists at most PICKER_LIST_LIMIT rows; the cards must cover
  // exactly the numbered rows, so a longer list is not silently selectable.
  const shown = workspaces.slice(0, PICKER_LIST_LIMIT);
  if (!shown.length) return { text, cards: [] };
  const opened = services.adminActions.openWorkspace({
    chat, user, purpose, workspaces: shown, currentPath,
    ...(currentSessionId ? { currentSessionId } : {}),
  });
  const cards = opened.pages.flatMap(page => {
    const card = workspacePickerCard(
      opened.group.workspaces,
      { nonce: page.nonce, offset: page.offset, total: opened.group.workspaces.length },
      purpose,
      { selectedPath: currentPath, ...(summary ? { summary } : {}) },
    );
    return card ? [card] : [];
  });
  return { text, cards };
}

/**
 * The Session picker for one list of operable Sessions. Exported because a card
 * tap loads the Sessions of the chosen Workspace and then needs the same stage
 * the command would have used.
 */
export function sessionPickerStage(
  services: CommandServices,
  chat: string,
  user: string,
  groups: readonly OperableGroup[],
  currentId: string | undefined,
  workspaceTitleText?: string,
  summary?: string,
): { readonly text: string; readonly cards: readonly TemplateCard[] } {
  const { text, sessions } = sessionPickerText(groups, currentId, workspaceTitleText ? { workspaceTitle: workspaceTitleText } : {});
  if (!sessions.length) return { text, cards: [] };
  const opened = services.adminActions.openSession({
    chat, user, sessions,
    workspaceTitle: workspaceTitleText ?? '',
    ...(currentId ? { currentSessionId: currentId } : {}),
  });
  const cards = opened.pages.flatMap(page => {
    const card = sessionPickerCard(
      opened.group.sessions,
      { nonce: page.nonce, offset: page.offset, total: opened.group.sessions.length },
      currentId,
      summary ? { summary } : {},
    );
    return card ? [card] : [];
  });
  return { text, cards };
}

/**
 * Load the Sessions of a Workspace a card (or a typed index) just chose.
 *
 * The workspace group is completed as「已选择」 only once the list has loaded;
 * a failure leaves it active so the administrator can pick another Workspace.
 * The caller delivers the returned text/cards (passive reply in a command,
 * proactive message from a card tap) and reports errors.
 */
export async function sessionsForWorkspace(
  services: CommandServices,
  input: {
    readonly chat: string;
    readonly user: string;
    readonly workspace: WorkspaceOption;
    readonly groupId: string;
    readonly currentId?: string;
  },
  current: () => boolean,
): Promise<{ readonly text: string; readonly cards: readonly TemplateCard[] } | undefined> {
  const groups = await services.directory.groups({ workspacePath: input.workspace.path });
  if (!current()) return undefined;
  services.adminActions.complete(input.groupId, 'selected', input.workspace.title);
  const stage = sessionPickerStage(
    services, input.chat, input.user, groups, input.currentId, input.workspace.title,
  );
  return { text: stage.text, cards: stage.cards };
}

function resolveFailureText(result: Extract<ResolveResult, { readonly ok: false }>): string {
  if (result.reason === 'ambiguous') return notice('⚠️', '匹配到多个会话', '请提供更长的会话 ID 前缀。');
  if (result.reason === 'unavailable') return notice('⚠️', '暂时无法读取 DSH 会话列表', '请稍后重试。');
  if (result.reason === 'forbidden') return notice('🔒', '该会话不在你的 Workspace 范围内', '请让操作者调整管理员的通知范围。');
  if (result.hidden === 'archived') return notice('⚠️', '该会话已归档', '归档的会话不能从企业微信操作。');
  if (result.hidden) return notice('⚠️', '该会话当前不可操作');
  return notice('⚠️', '找不到该会话', `发送 ${code('/session')} 查看可切换的会话。`);
}

/** `/session` without a Workspace step: list the Sessions the scope covers. */
async function showSessions(
  services: CommandServices,
  scope: CommandScope,
  options: {
    readonly scopePath?: string;
    readonly currentId?: string;
    readonly lead?: string;
    readonly summaryText?: string;
    readonly current: () => boolean;
  },
): Promise<void> {
  try {
    const groups = await services.directory.groups(options.scopePath ? { workspacePath: options.scopePath } : undefined);
    if (!options.current()) return;
    const title = options.scopePath ? await workspaceTitle(services, options.scopePath) : undefined;
    if (!options.current()) return;
    const stage = sessionPickerStage(
      services, scope.message.chat, scope.message.user, groups, options.currentId, title, options.summaryText,
    );
    await scope.replyCards([options.lead, stage.text].filter(Boolean).join('\n\n'), stage.cards);
  } catch {
    if (options.current()) await scope.reply(notice('⚠️', '读取 DSH 会话列表失败', '请稍后重试，或到 DSH 页面查看。'));
  }
}

/** Resolve a token by Session id prefix, then switch to it. */
async function switchByToken(
  services: CommandServices,
  scope: CommandScope,
  token: string,
  current: () => boolean,
): Promise<void> {
  const result = await services.directory.resolve(token);
  if (!current()) return;
  if (!result.ok) { await scope.reply(resolveFailureText(result)); return; }
  const ok = await switchSessionForAdmin(services, {
    chat: scope.message.chat, user: scope.message.user, sessionId: result.session.sessionId, roundId: scope.round.id,
  }, current);
  if (!ok) {
    if (current()) await scope.reply(notice('⚠️', '该会话已不可用', '它可能已归档，或不在当前管理员的 Workspace 范围内。'));
    return;
  }
  await scope.reply(sessionSwitchedText(result.session.title, result.session.workspace, result.session.sessionId));
}

export async function runCommand(services: CommandServices, scope: CommandScope, command: ParsedCommand): Promise<void> {
  const { message, reply } = scope;
  const { directory, selection, interactions, policy } = services;
  const ticket = services.ticket(message);
  const current = () => !services.stale(ticket);
  const isAdmin = policy.isAdmin(message.user);
  // An administrator command in a group chat is refused whoever sends it: the
  // shared conversation is not the place to manage the Bot. The reply names the
  // real reason — rank for a member, the shared chat for an administrator.
  if (message.chatType === 'group' && ADMIN_ONLY_COMMANDS.has(command.name)) {
    await reply(isAdmin ? adminPrivateOnlyText() : adminOnlyText());
    return;
  }
  // Commands that touch this conversation's Session (compact, delete) are open
  // to everybody in a private chat; in a group chat that Session is shared, so
  // they need an administrator — and the refusal says *that*, because a member
  // in a group is usually after their own Session, not the group's.
  const allowed = (): boolean => isAdmin || message.chatType === 'single';
  const deny = async (): Promise<void> => {
    await reply(message.chatType === 'group' ? groupSessionRefusalText(command.name) : adminOnlyText());
  };

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
          ? `你是本插件的管理员：可以新建和切换会话、按 Workspace 接收通知。`
          : `你不是本插件的管理员：消息只会进入你自己的专属会话，发送 ${code('/delete')} 可以清空它的记忆。`,
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
      const running = info?.running === true;
      const lines = [
        title('🧭', '当前状态'),
        '',
        target.sessionId
          ? bullet('会话', sessionRef(info?.title, target.sessionId))
          : bullet('会话', isAdmin && !target.binding
            ? '尚未选择（请先发送 /new 新建或 /session 选择）' : '尚未创建（发送任意消息即会自动创建）'),
        ...(info?.workspace ? [bullet('Workspace', inline(info.workspace, 120))] : []),
        ...(target.sessionId ? [bullet('preset', info?.preset ? code(inline(info.preset, 60)) : 'DSH 默认')] : []),
        ...(info?.model ? [bullet('模型', code(`${info.model.provider}/${info.model.model}`))] : []),
        ...(info?.model?.reasoningEffort ? [bullet('effort', code(inline(info.model.reasoningEffort, 40)))] : []),
        ...(info?.context ? [bullet('上下文', formatContext(info.context.used, info.context.window))] : []),
        ...(info?.turns !== undefined || info?.steps !== undefined
          ? [bullet('进度', `第 ${info?.turns ?? 0} 轮 · 累计 ${info?.steps ?? 0} 步`)]
          : []),
        ...(target.sessionId
          ? [bullet('运行状态', questions ? '等待回答提问' : running ? '运行中' : '空闲')]
          : []),
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

    case 'new': {
      if (!isAdmin) { await deny(); return; }
      const token = command.args[0];
      const pending = services.adminActions.byChat(message.chat, message.user);
      if (token) {
        const index = /^\d{1,3}$/.test(token) ? Number(token) : undefined;
        if (index === undefined || !pending || pending.kind !== 'workspace' || pending.purpose !== 'new') {
          await reply(notice('ℹ️', '请先发送 /new', '先查看 Workspace 列表，再用 /new 序号 选择。'));
          return;
        }
        const picked = pending.workspaces[index - 1];
        if (!picked) {
          await reply(notice('⚠️', '没有这个 Workspace', `发送 ${code('/new')} 查看序号。`));
          return;
        }
        if (!services.adminActions.begin(pending.pageNonces[0]!)) {
          await reply(notice('⏳', '正在处理上一条选择', '请稍候再试。'));
          return;
        }
        try {
          const created = await createSessionForAdmin(services, {
            chat: message.chat, user: message.user, workspace: picked.path, roundId: scope.round.id,
          }, current);
          if (!created) return;
          services.adminActions.complete(pending.id, 'created', picked.title);
          await reply(newSessionText(created.workspaceTitle, created.sessionId));
        } catch (error) {
          services.adminActions.release(pending.pageNonces[0]!);
          if (current()) await reply(notice('⚠️', '新建会话失败', inline(error instanceof Error ? error.message : String(error), 300)));
        }
        return;
      }

      const list = services.workspaces.list();
      const available = allowedWorkspaces(services);
      if (available.length <= 1) {
        const path = available[0]?.path;
        if (path === undefined && !(list.length === 0 && services.policy.adminWorkspaceAllowed(''))) {
          await reply(notice('⚠️', '没有可用的 Workspace', '当前通知范围没有覆盖任何 Workspace；请先在插件主页的「管理员 → 通知范围」里至少勾选一个。'));
          return;
        }
        try {
          const created = await createSessionForAdmin(services, {
            chat: message.chat, user: message.user, workspace: path ?? '', roundId: scope.round.id,
          }, current);
          if (!created || !current()) return;
          await reply(newSessionText(created.workspaceTitle, created.sessionId));
        } catch (error) {
          if (current()) await reply(notice('⚠️', '新建会话失败', inline(error instanceof Error ? error.message : String(error), 300)));
        }
        return;
      }

      const stage = workspacePickerStage(
        services, message.chat, message.user, 'new', available, preferredWorkspace(services, message.user),
      );
      await scope.replyCards(stage.text, stage.cards);
      return;
    }

    case 'session': {
      if (!isAdmin) { await deny(); return; }
      const target = await services.current(message);
      const info = target.sessionId ? await directory.describe(target.sessionId) : undefined;
      if (!current()) return;
      const summary = currentSessionText(info, target.sessionId);
      const summaryLine = pickerSummaryText(info, target.sessionId);
      const token = command.args[0];
      const pending = services.adminActions.byChat(message.chat, message.user);

      if (token) {
        const index = /^\d{1,3}$/.test(token) ? Number(token) : undefined;
        if (index !== undefined && pending?.kind === 'workspace' && pending.purpose === 'session') {
          const picked = pending.workspaces[index - 1];
          if (!picked) {
            await reply(notice('⚠️', '没有这个 Workspace', `发送 ${code('/session')} 查看序号。`));
            return;
          }
          if (!services.adminActions.begin(pending.pageNonces[0]!)) {
            await reply(notice('⏳', '正在处理上一条选择', '请稍候再试。'));
            return;
          }
          try {
            const stage = await sessionsForWorkspace(services, {
              chat: message.chat, user: message.user, workspace: picked, groupId: pending.id,
              ...(target.sessionId ? { currentId: target.sessionId } : {}),
            }, current);
            if (!stage) return;
            await scope.replyCards([summary, stage.text].join('\n\n'), stage.cards);
          } catch {
            services.adminActions.release(pending.pageNonces[0]!);
            if (current()) await reply(notice('⚠️', '读取 DSH 会话列表失败', '请稍后重试，或到 DSH 页面查看。'));
          }
          return;
        }
        if (index !== undefined) {
          const picked = pending?.kind === 'session' ? pending.sessions[index - 1] : undefined;
          if (!picked) {
            await reply(notice('ℹ️', '请先发送 /session', '先查看会话列表，再用 /session 序号 切换。'));
            return;
          }
          if (!services.adminActions.begin(pending!.pageNonces[0]!)) {
            await reply(notice('⏳', '正在处理上一条选择', '请稍候再试。'));
            return;
          }
          const ok = await switchSessionForAdmin(services, {
            chat: message.chat, user: message.user, sessionId: picked.sessionId, roundId: scope.round.id,
          }, current);
          if (!ok) {
            services.adminActions.release(pending!.pageNonces[0]!);
            if (current()) await reply(notice('⚠️', '该会话已不可用', '它可能已归档，或不在当前管理员的 Workspace 范围内。'));
            return;
          }
          services.adminActions.complete(pending!.id, 'switched', picked.title ?? picked.sessionId);
          await reply(sessionSwitchedText(picked.title, picked.workspace, picked.sessionId));
          return;
        }
        await switchByToken(services, scope, token, current);
        return;
      }

      const available = allowedWorkspaces(services);
      if (available.length >= 2) {
        const stage = workspacePickerStage(
          services, message.chat, message.user, 'session', available, info?.workspacePath ?? '', target.sessionId, summaryLine,
        );
        await scope.replyCards([summary, stage.text].join('\n\n'), stage.cards);
        return;
      }
      const scopePath = available.length === 1 ? available[0]!.path : undefined;
      await showSessions(services, scope, {
        ...(scopePath ? { scopePath } : {}),
        ...(target.sessionId ? { currentId: target.sessionId } : {}),
        lead: summary,
        summaryText: summaryLine,
        current,
      });
      return;
    }

    case 'reset': {
      if (!isAdmin) { await deny(); return; }
      selection.clear(message.chat, message.user);
      services.adminActions.clearChat(message.chat);
      if (!current()) return;
      const target = await services.current(message);
      if (!target.sessionId) {
        await reply(target.binding
          ? notice('↩️', '已放弃切换', '你还没有专属会话，发送任意消息即可创建。')
          : adminUnassignedText());
        return;
      }
      const info = await directory.describe(target.sessionId);
      if (!current()) return;
      await reply(`${title('↩️', '已放弃切换')} · 回到你自己的专属会话${sessionLabel(info.title)}`);
      return;
    }

    case 'compact': {
      const target = await services.current(message);
      if (!current()) return;
      if (!target.sessionId) { await reply(isAdmin && !target.binding ? adminUnassignedText()
        : notice('ℹ️', '你还没有专属会话', '发送任意消息即可创建。')); return; }
      if (!allowed()) { await deny(); return; }
      try {
        const outcome = await services.ops.compact(target.sessionId);
        if (!current()) return;
        await reply(outcome ? compactedText(outcome.items, outcome.tokens) : nothingToCompactText());
      } catch (error) {
        if (current()) await reply(notice('⚠️', '上下文压缩失败', inline(error instanceof Error ? error.message : String(error), 300)));
      }
      return;
    }

    case 'delete': {
      const target = await services.current(message);
      if (!current()) return;
      if (!target.sessionId) { await reply(isAdmin && !target.binding ? adminUnassignedText()
        : notice('ℹ️', '你还没有专属会话', '发送任意消息即可创建。')); return; }
      if (!allowed()) { await deny(); return; }
      const confirmed = (command.args[0] ?? '').toLowerCase() === 'confirm';
      if (!confirmed) {
        const info = await directory.describe(target.sessionId);
        if (!current()) return;
        await reply(deleteWarningText(info.title, target.sessionId));
        return;
      }
      try {
        const info = await directory.describe(target.sessionId);
        if (!current()) return;
        await services.archiveSession(message, target.sessionId);
        if (!current()) return;
        services.journal.write({
          event: 'wecom.session.delete', roundId: scope.round.id, chatId: message.chat,
          userId: message.user, sessionId: target.sessionId,
        });
        await reply(`${deletedText()}\n\n> 已归档${sessionLabel(info.title)}`);
      } catch (error) {
        if (current()) await reply(notice('⚠️', '归档会话失败', inline(error instanceof Error ? error.message : String(error), 300)));
      }
      return;
    }

    case 'cancel': {
      const target = await services.current(message);
      if (!current()) return;
      if (!target.sessionId) { await reply(isAdmin && !target.binding ? adminUnassignedText()
        : notice('ℹ️', '你还没有专属会话', '发送任意消息即可创建。')); return; }
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
        await reply(command.args[0] && interactions.wasClosed(command.args[0]) ? interactionIgnoredText()
          : notice('⚠️', '没有对应的待回答提问', '验证码可能无效或已经过期。'));
        return;
      }
      const target = await services.current(message);
      const mayAnswer = target.sessionId === state.sessionId
        || (isAdmin && message.chatType === 'single' && await directory.permitted(state.sessionId));
      if (!current()) return;
      if (!mayAnswer) {
        await reply(questionAccessRefusalText());
        return;
      }
      if (!state.active()) { await reply(interactionIgnoredText()); return; }
      let question = state.questions.length === 1 ? state.questions[0] : undefined;
      let answer = textAfterTokens(command.rest, 1);
      if (question && command.args[1] === question.id && command.args.length > 2) answer = textAfterTokens(command.rest, 2);
      if (state.questions.length > 1) {
        // The dropdown card numbers its questions 1, 2, 3 and never shows ids.
        question = state.questions.find(q => q.id === command.args[1])
          ?? (/^[1-9]$/.test(command.args[1] ?? '') ? state.questions[Number(command.args[1]) - 1] : undefined);
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
      if (remaining.length) {
        await reply(`${title('📝', '已记录')} · 还需回答：${remaining.map(q => inline(q.id, 60)).join('、')}`);
      } else {
        const result = await state.submit({ answers: state.questions.map(q => state.answers.get(q.id)!) });
        await reply(result === 'closed' ? interactionIgnoredText()
          : result === 'submitted' ? interactionSubmittedText('question') : title('✅', '答案已提交给 DSH'));
      }
      return;
    }

    case 'approve':
    case 'deny': {
      const state = command.args[0] ? interactions.findApproval(command.args[0]) : undefined;
      // Reaching here already means a single chat (a group is refused above);
      // the approval must still be visible to this chat and the sender an
      // administrator.
      if (!state || command.args.length !== 1 || !state.privateChats.has(message.chat) || !isAdmin) {
        await reply(command.args[0] && interactions.wasClosed(command.args[0]) ? interactionIgnoredText()
          : notice('⚠️', '没有可在此单聊审批的请求', '只有管理员可以在单聊里用验证码审批；验证码也可能已经过期。'));
        return;
      }
      const permitted = await directory.permitted(state.sessionId);
      if (!current()) return;
      if (!permitted) { await reply(questionAccessRefusalText()); return; }
      if (!state.active()) { await reply(interactionIgnoredText()); return; }
      const outcome = command.name === 'approve' ? 'allowed-once' : 'rejected';
      const result = await state.submit(outcome);
      services.journal.write({ event: 'dsh.approval.answer', roundId: scope.round.id, sessionId: state.sessionId, toolName: state.toolName, callId: state.callId, outcome, submission: result });
      await reply(result === 'closed' ? interactionIgnoredText()
        : result === 'submitted' ? interactionSubmittedText('approval')
          : title(outcome === 'allowed-once' ? '✅' : '🚫', outcome === 'allowed-once' ? '已允许本次工具调用' : '已拒绝本次工具调用'));
      return;
    }

    case 'workspaces':
    case 'ws':
    case 'sessions':
    case 'list':
    case 'ls':
    case 'use':
      await reply(retiredCommandText());
      return;

    default:
      await reply(`${title('❓', '未知命令')} · 发送 ${code('/help')} 查看可用命令。`);
  }
}
