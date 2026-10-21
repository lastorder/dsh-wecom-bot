import { useEffect, useRef, useState } from 'react';
import {
  Button, IconChevronRightOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconTrashOutlineRegular,
  Input, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { BridgeStateView, GroupMemberView, GroupView, StoreOp, WorkspaceOption } from '../../shared/protocol.ts';
import { useStoreApply } from '../hooks.ts';
import {
  SESSION_STATE_LABEL, addGroup, archiveMember, choiceLabel, contextLabel, deleteGroup,
  displayPath, dshDefaultLabel, effortLabel, effortsFor, groupModelSummary, modelKey, modelName, parseModelKey,
  presetLabel, presetName, presetSummaryLabel, removeMember, setLabel, setMemberModel, updateGroup, updateMember,
} from '../model.ts';
import { Card, Collapse, ConfirmDialog, CountTag, Empty, PersonAvatar, PersonDialog, Select, SessionDialog } from './ui.tsx';
import type { OpenSession } from '../types.ts';

/**
 * Step 2: user groups. A group owns a Workspace, a model (with its effort) and
 * an agent preset; its members are the WeCom users (private chats) and group
 * chats that may talk to the Bot. The built-in 「默认分组」 cannot be deleted.
 *
 * 编辑 becomes 保存: the whole form is one draft and one write, so a group is
 * never half-configured. A member is one line — badge, name, the five Session
 * facts and its 归档 button — because the operator reads this table far more
 * often than they change it. Adding a member is the 「未授权用户」 card's job;
 * a Session is replaced by archiving it, which the next message turns into a
 * fresh one from the group's defaults.
 *
 * Every interactive cell looks like a control: the Session state is a pill that
 * opens an identity dialog (name, id, and the actual 「在 DSH 中打开」 button),
 * and model/effort are always-rendered selects so one click opens the list.
 */
export function GroupsCard({ state, error, disabled, refreshing, onRefresh, onChanged, onOpenSession }: {
  state: BridgeStateView | undefined;
  error?: string;
  disabled: boolean;
  refreshing: boolean;
  onRefresh(): void;
  onChanged(): void;
  onOpenSession?: OpenSession;
}) {
  const { busy, error: applyError, apply } = useStoreApply(onChanged);
  const [freshId, setFreshId] = useState<string>();
  const view = state?.routing;

  // A group created here opens its own form; the flag is consumed by the first
  // render of the new panel (which captures it as its initial state).
  useEffect(() => {
    if (freshId && view?.groups.some(group => group.id === freshId)) setFreshId(undefined);
  }, [freshId, view]);

  const add = async (): Promise<void> => {
    const response = await apply('group:new', [addGroup()]);
    if (response?.createdGroupId) setFreshId(response.createdGroupId);
  };

  return (
    <Card
      step={2}
      title="用户分组"
      description="每个分组决定成员在哪个 Workspace、用哪个模型与 preset；把企微用户或群聊放进分组即为授权。改动即时生效。"
      aside={<>
        <CountTag count={view?.groups.length ?? 0} noun="个分组" tone="quiet" />
        <CountTag count={view?.total ?? 0} noun="位成员" />
      </>}
    >
      <div className="wcb-toolbar">
        <span className="wcb-grow wcb-hint">
          没有分组的用户无法与机器人对话；他们发消息后会出现在「未授权用户」卡片里，加入分组即完成授权。
        </span>
        <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular />} disabled={refreshing} onClick={onRefresh}>
          {refreshing ? '刷新中' : '刷新'}
        </Button>
        <Button variant="outline" size="sm" icon={<IconPlusOutlineRegular />} disabled={disabled || busy === 'group:new'} onClick={() => { void add(); }}>
          添加分组
        </Button>
      </div>

      {applyError && (
        <div className="wcb-banner" data-tone="danger" role="status">
          <div><div className="wcb-banner-body">{applyError}</div></div>
        </div>
      )}

      {!view ? (
        <Empty>{error ?? state?.routingError ?? '正在读取分组信息…'}</Empty>
      ) : (
        <div className="wcb-groups">
          {view.groups.map(group => (
            <GroupPanel
              key={group.id}
              group={group}
              state={state}
              startEditing={group.id === freshId}
              disabled={disabled || busy.startsWith(`group:${group.id}`)}
              onApply={apply}
              onChanged={onChanged}
              onOpenSession={onOpenSession}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

interface GroupDraft {
  name: string;
  workspace: string;
  provider: string;
  model: string;
  effort: string;
  preset: string;
}

function draftOf(group: GroupView): GroupDraft {
  return {
    name: group.name, workspace: group.workspace, provider: group.provider,
    model: group.model, effort: group.reasoningEffort ?? '', preset: group.preset,
  };
}

/** The minimal patch that turns `group` into `draft`; empty when nothing changed. */
function patchOf(group: GroupView, draft: GroupDraft): Parameters<typeof updateGroup>[1] {
  const patch: {
    name?: string; workspace?: string; provider?: string; model?: string; reasoningEffort?: string; preset?: string;
  } = {};
  const name = draft.name.trim();
  if (name && name !== group.name) patch.name = name;
  if (draft.workspace !== group.workspace) patch.workspace = draft.workspace;
  if (draft.provider !== group.provider || draft.model !== group.model) {
    // A model change resets the effort: the new model may not offer the old one.
    patch.provider = draft.provider;
    patch.model = draft.model;
    patch.reasoningEffort = '';
  } else if (draft.effort !== (group.reasoningEffort ?? '')) {
    patch.reasoningEffort = draft.effort;
  }
  if (draft.preset !== group.preset) patch.preset = draft.preset;
  return patch;
}

function GroupPanel({ group, state, startEditing, disabled, onApply, onChanged, onOpenSession }: {
  group: GroupView;
  state: BridgeStateView | undefined;
  startEditing: boolean;
  disabled: boolean;
  onApply(key: string, ops: StoreOp[]): Promise<unknown>;
  onChanged(): void;
  onOpenSession?: OpenSession;
}) {
  const [open, setOpen] = useState(startEditing);
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState<GroupDraft>(() => draftOf(group));
  const [confirming, setConfirming] = useState(false);
  const catalog = state?.models;
  const presets = state?.presets;
  const workspaces: readonly WorkspaceOption[] = state?.workspaces ?? [];
  const key = `group:${group.id}`;
  // The collapsed row is the group's whole overview, so every fact it owns is
  // named there — including the effort and the preset, which are easy to get
  // wrong (and invisible without opening the form). They are passed as a grid
  // of labelled facts, not a sentence: the same column in the next group always
  // holds the same fact.
  const effort = group.reasoningEffort
    ? (effortLabel(catalog, {
      provider: group.effectiveProvider, model: group.effectiveModel, reasoningEffort: group.reasoningEffort,
    }) || group.reasoningEffort)
    : '默认';
  const facts = [
    { key: 'members', label: '成员', value: `${group.memberCount} 位` },
    { key: 'workspace', label: 'Workspace', value: group.workspaceTitle, title: group.workspacePath },
    { key: 'model', label: '模型', value: groupModelSummary(catalog, group) },
    { key: 'effort', label: 'effort', value: effort },
    { key: 'preset', label: 'preset', value: presetSummaryLabel(presets, group.preset) },
  ];

  // Leaving the form (a save, a delete elsewhere) re-seeds the draft from truth.
  useEffect(() => { if (!editing) setDraft(draftOf(group)); }, [group, editing]);

  const efforts = effortsFor(catalog, draft.provider || group.effectiveProvider, draft.model || group.effectiveModel);
  const update = (patch: Partial<GroupDraft>): void => setDraft(current => ({ ...current, ...patch }));

  const startEdit = (): void => {
    setDraft(draftOf(group));
    setEditing(true);
    setOpen(true);
  };

  const save = async (): Promise<void> => {
    const patch = patchOf(group, draft);
    if (!Object.keys(patch).length) { setEditing(false); return; }
    const response = await onApply(key, [updateGroup(group.id, patch)]);
    if (response) setEditing(false);
  };

  return (
    <Collapse
      open={open}
      onToggle={() => setOpen(value => !value)}
      title={<>{group.name}{group.isDefault && <Tag tone="quiet">默认</Tag>}</>}
      facts={facts}
      actions={<>
        {editing ? (
          <>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { setEditing(false); setDraft(draftOf(group)); }}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={disabled} onClick={() => { void save(); }}>
              保存
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" disabled={disabled} aria-label={`编辑 ${group.name}`} onClick={startEdit}>
            编辑
          </Button>
        )}
        {!group.isDefault && (confirming ? (
          <>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirming(false)}>取消</Button>
            <Button
              variant="outline" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled}
              onClick={() => { void onApply(key, [deleteGroup(group.id)]); }}
            >
              确认删除
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled} onClick={() => setConfirming(true)}>
            删除分组
          </Button>
        ))}
      </>}
    >
      {editing && (
        <div className="wcb-binding-controls">
          <label className="wcb-binding-field">
            <span className="wcb-binding-label">分组名称</span>
            <Input
              value={draft.name}
              disabled={disabled}
              aria-label={`${group.name} 的名称`}
              onChange={event => update({ name: event.target.value })}
            />
          </label>

          <label className="wcb-binding-field">
            <span className="wcb-binding-label">Workspace</span>
            <Select
              value={draft.workspace}
              disabled={disabled}
              aria-label={`${group.name} 的 Workspace`}
              onChange={event => update({ workspace: event.target.value })}
            >
              <option value="">插件自带（{displayPath(workspaces.find(workspace => workspace.pluginOwned)?.path)}）</option>
              {workspaces.map(workspace => (
                <option key={workspace.path} value={workspace.path}>
                  {workspace.title} — {displayPath(workspace.path)}
                </option>
              ))}
              {draft.workspace && !workspaces.some(workspace => workspace.path === draft.workspace) && (
                <option value={draft.workspace}>{displayPath(draft.workspace)}（未注册）</option>
              )}
            </Select>
          </label>

          <label className="wcb-binding-field">
            <span className="wcb-binding-label">模型</span>
            <Select
              value={modelKey(draft.provider, draft.model)}
              disabled={disabled || !catalog}
              aria-label={`${group.name} 的模型`}
              onChange={event => {
                const next = parseModelKey(event.target.value);
                update({ provider: next.provider, model: next.model, effort: '' });
              }}
            >
              <option value="">{dshDefaultLabel(catalog)}</option>
              {(catalog?.choices ?? []).map(choice => (
                <option key={modelKey(choice.provider, choice.model)} value={modelKey(choice.provider, choice.model)}>
                  {choice.providerName} / {choiceLabel(choice)}
                </option>
              ))}
            </Select>
          </label>

          <label className="wcb-binding-field">
            <span className="wcb-binding-label">effort（思考强度）</span>
            <Select
              value={draft.effort}
              disabled={disabled || !efforts.length || !(draft.provider || draft.model)}
              aria-label={`${group.name} 的 effort`}
              onChange={event => update({ effort: event.target.value })}
            >
              <option value="">默认</option>
              {efforts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>

          <label className="wcb-binding-field">
            <span className="wcb-binding-label">preset</span>
            <Select
              value={draft.preset}
              disabled={disabled || !presets?.presets.length}
              aria-label={`${group.name} 的 preset`}
              onChange={event => update({ preset: event.target.value })}
            >
              <option value="">{presetLabel(presets, '')}</option>
              {(presets?.presets ?? []).map(preset => (
                <option key={preset.id} value={preset.id}>
                  {presetName(preset)}{preset.broken ? '（不可用）' : ''}
                </option>
              ))}
            </Select>
          </label>
        </div>
      )}
      {editing && (!efforts.length || !presets?.presets.length) && (
        <div className="wcb-hint">
          {!efforts.length && '当前模型没有可选的 effort：先选一个支持思考强度的模型，或让 DSH 默认模型决定。'}
          {!efforts.length && !presets?.presets.length && ' '}
          {!presets?.presets.length && `没有读到 DSH 的 preset 列表${state?.presetsError ? `：${state.presetsError}` : '（这个部署没有挂载 preset registry）'}。`}
        </div>
      )}

      {group.workspaceError && <div className="wcb-hint wcb-inline-error">{group.workspaceError}</div>}
      {editing && (
        <div className="wcb-hint">
          更换 Workspace 后，本组成员的会话会在下一条消息时重新创建。模型与 effort 是本组默认值，不覆盖成员为当前会话单独选择的模型；
          preset 只影响此后新建的会话（DSH 不允许改写已经开始的会话）。
        </div>
      )}

      {group.members.length === 0 ? (
        <Empty>这个分组还没有成员。让对方先给机器人发一条消息，然后在「未授权用户」里把 TA 加入本组。</Empty>
      ) : (
        <div className="wcb-members-scroll" tabIndex={0} role="region" aria-label={`${group.name} 成员表格，可横向滚动`}>
          <table className="wcb-members-table" aria-label={`${group.name} 的成员`}>
            <thead><tr>{['成员', '会话', 'preset', '模型', 'effort', '上下文', '操作'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>
              {group.members.map(member => (
                <MemberRow
                  key={`${member.key}:${member.sessionId}`}
                  member={member}
                  group={group}
                  groups={state?.routing?.groups ?? []}
                  state={state}
                  disabled={disabled}
                  onChanged={onChanged}
                  onOpenSession={onOpenSession}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Collapse>
  );
}

/** One semantic table row; edits affect only this member's current Session. */
function MemberRow({ member, group, groups, state, disabled, onChanged, onOpenSession }: {
  member: GroupMemberView;
  group: GroupView;
  groups: readonly GroupView[];
  state: BridgeStateView | undefined;
  disabled: boolean;
  onChanged(): void;
  onOpenSession?: OpenSession;
}) {
  const [details, setDetails] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [navigationError, setNavigationError] = useState<string>();
  const pending = useRef(false);
  const write = useStoreApply(onChanged);
  const blocked = disabled || Boolean(write.busy);
  const catalog = state?.models;
  const selection = member.sessionSelection ?? member.sessionModel;
  const efforts = effortsFor(catalog, selection?.provider ?? '', selection?.model ?? '');
  const usable = Boolean(member.sessionId) && (member.sessionState === 'bound' || member.sessionState === 'blank');
  const name = member.displayName;
  const sessionTitle = member.sessionTitle || '未命名会话';
  const sessionInfo = `会话：${sessionTitle}\nSession ID：${member.sessionId}`;
  const error = write.error ?? navigationError;

  // Each row owns its busy/error state. The ref also rejects a second action
  // before React commits the busy state from the first one.
  const apply = async (_key: string, ops: StoreOp[]): Promise<unknown> => {
    if (disabled || pending.current) return undefined;
    pending.current = true;
    setNavigationError(undefined);
    try { return await write.apply(member.key, ops); }
    finally { pending.current = false; }
  };

  // Navigation is the only thing that leaves the page, and only from the
  // dialog: the compact state in the table opens the identity first.
  const openSession = async (): Promise<void> => {
    setNavigationError(undefined);
    try {
      if (!onOpenSession) throw new Error('DSH 会话导航暂不可用，请刷新页面后重试。');
      await onOpenSession(member.sessionId);
      setSessionOpen(false);
    } catch (cause) {
      setNavigationError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const showSession = (): void => {
    setNavigationError(undefined);
    setSessionOpen(true);
  };

  const closeSession = (): void => {
    if (pending.current) return;
    setSessionOpen(false);
    setNavigationError(undefined);
  };

  const changeModel = async (value: string): Promise<void> => {
    const next = parseModelKey(value);
    if (!usable || !next.provider || !next.model) return;
    if (next.provider === selection?.provider && next.model === selection?.model) return;
    // A different model starts at its own default effort, never the previous
    // model's effort. A subsequent effort choice can pick an offered value.
    await apply(member.key, [setMemberModel(member.key, member.sessionId, next)]);
  };

  const changeEffort = async (value: string): Promise<void> => {
    if (!usable || !selection || (value && !efforts.some(item => item.id === value))) return;
    if (value === (selection.reasoningEffort ?? '')) return;
    const next = { provider: selection.provider, model: selection.model, ...(value ? { reasoningEffort: value } : {}) };
    await apply(member.key, [setMemberModel(member.key, member.sessionId, next)]);
  };

  return (
    <>
      <tr className="wcb-member-row" aria-busy={Boolean(write.busy)}>
        <td>
          <div className="wcb-member-identity">
            <PersonAvatar kind={member.kind} label={`${name} 的详情`} disabled={blocked} onClick={() => setDetails(true)} />
            <span className="wcb-member-name" title={name}>{name}</span>
            {member.admin && <Tag tone="success">管理员</Tag>}
          </div>
          <PersonDialog
            open={details}
            onClose={() => { if (!pending.current) setDetails(false); }}
            title={name}
            id={member.id}
            label={member.label}
            noteLabel={`${member.id} 的备注`}
            disabled={blocked}
            onNote={next => { void apply(member.key, [setLabel(member.key, next)]); }}
            footer={<RemoveMember member={member} disabled={blocked} onApply={apply} />}
          >
            <label className="wcb-binding-field">
              <span className="wcb-binding-label">所属分组</span>
              <Select
                value={group.id} disabled={blocked} aria-label={`${member.id} 的所属分组`}
                onChange={event => {
                  const groupId = event.target.value;
                  if (!groupId || groupId === group.id) return;
                  void apply(member.key, [updateMember(member.key, { groupId })]);
                }}
              >
                {groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
              <span className="wcb-hint">切换后解除当前绑定，恢复目标分组原有的可用会话；没有可恢复会话时，下一条消息按目标组配置创建。</span>
            </label>
            {write.error && <div className="wcb-field-error" role="alert">{write.error}</div>}
          </PersonDialog>
        </td>
        <td>
          {usable ? (
            <>
              <button type="button" className="wcb-cell-pill" title={sessionInfo}
                aria-label={`查看 ${name} 的会话详情`}
                onClick={showSession}>
                <StateDot state={member.sessionRunning ? 'ongoing' : 'idle'} size={8} />
                {member.sessionState === 'blank' ? '待使用' : '已绑定'}
                <span className="wcb-cell-pill-chevron" aria-hidden="true"><IconChevronRightOutlineRegular size={11} /></span>
              </button>
              <SessionDialog
                open={sessionOpen}
                onClose={closeSession}
                name={name}
                title={sessionTitle}
                id={member.sessionId}
                running={member.sessionRunning}
                blank={member.sessionState === 'blank'}
                disabled={Boolean(write.busy)}
                error={navigationError}
                onOpen={() => { void openSession(); }}
              />
            </>
          ) : <span className="wcb-muted" title={member.sessionId ? sessionInfo : undefined}>{SESSION_STATE_LABEL[member.sessionState]}</span>}
        </td>
        <td>{member.sessionPreset ? presetLabel(state?.presets, member.sessionPreset) : '—'}</td>
        <td>
          {usable ? (
            // Always a select: one click opens the list. The previous
            // click-to-swap-a-button behaviour needed a second click, because
            // an autofocused select does not open its popup by itself.
            <Select
              className="wcb-cell-select"
              value={modelKey(selection?.provider ?? '', selection?.model ?? '')}
              disabled={blocked || !catalog?.choices.length}
              aria-label={`${member.id} 当前会话的模型`}
              title="只修改当前会话；新会话仍使用分组默认模型"
              onChange={event => { void changeModel(event.target.value); }}
            >
              {!selection && <option value="" disabled>请选择模型</option>}
              {selection && !catalog?.choices.some(item => item.provider === selection.provider && item.model === selection.model)
                && <option value={modelKey(selection.provider, selection.model)}>{modelName(catalog, selection)}（当前）</option>}
              {(catalog?.choices ?? []).map(choice => (
                <option
                  key={modelKey(choice.provider, choice.model)} value={modelKey(choice.provider, choice.model)}
                  title={`${choice.providerName} / ${choiceLabel(choice)}`}
                >
                  {choice.name}
                </option>
              ))}
            </Select>
          ) : <span className="wcb-muted">—</span>}
        </td>
        <td>
          {usable && selection ? (
            <Select
              className="wcb-cell-select"
              value={selection.reasoningEffort ?? ''}
              disabled={blocked || !efforts.length}
              aria-label={`${member.id} 当前会话的 effort`}
              title={efforts.length ? '只修改当前会话的思考强度' : '当前模型没有可选的思考强度'}
              onChange={event => { void changeEffort(event.target.value); }}
            >
              <option value="">默认</option>
              {efforts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          ) : <span className="wcb-muted">—</span>}
        </td>
        <td className="wcb-context-cell">{contextLabel(member.sessionContext) || '—'}</td>
        <td>
          {member.sessionId && (
            <Button
              variant="outline" size="sm" icon={<IconTrashOutlineRegular />} disabled={blocked}
              aria-label={`归档 ${name} 的会话`} onClick={() => setArchiving(true)}
            >
              归档会话
            </Button>
          )}
          <ConfirmDialog open={archiving} title={`归档「${name}」的会话？`} confirmLabel="确认归档"
            busy={Boolean(write.busy)} disabled={disabled} onCancel={() => { if (!pending.current) setArchiving(false); }}
            onConfirm={() => { void apply(member.key, [archiveMember(member.key)]).then(result => { if (result) setArchiving(false); }); }}>
            <p>归档后这个会话不再被继续，它的历史不会再进入任何请求；下一条消息会按分组当前的 Workspace、模型与 preset 新建一个会话。DSH 的会话文件仍保留在磁盘上，需要时可到 DSH 页面查看。</p>
            {write.error && <div className="wcb-field-error" role="alert">{write.error}</div>}
          </ConfirmDialog>
        </td>
      </tr>
      {error && !details && !archiving && !sessionOpen && <tr className="wcb-member-error"><td colSpan={7}><div className="wcb-field-error" role="alert">{error}</div></td></tr>}
    </>
  );
}

/** 移出分组, with its own confirmation step, inside the details dialog. */
function RemoveMember({ member, disabled, onApply }: {
  member: GroupMemberView;
  disabled: boolean;
  onApply(key: string, ops: StoreOp[]): Promise<unknown>;
}) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirming(false)}>取消</Button>
      <Button
        variant="outline" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled}
        onClick={() => { void onApply(member.key, [removeMember(member.key)]); }}
      >
        确认移出「{member.displayName}」
      </Button>
    </>
  ) : (
    <Button variant="outline" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled} onClick={() => setConfirming(true)}>
      移出分组
    </Button>
  );
}
