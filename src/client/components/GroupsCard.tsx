import { useEffect, useState } from 'react';
import {
  Button, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconTrashOutlineRegular, Input, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { BridgeStateView, GroupMemberView, GroupView, RoutingOp, WorkspaceOption } from '../../shared/protocol.ts';
import { useRoutingApply } from '../hooks.ts';
import {
  BINDING_KIND_LABEL, SESSION_STATE_LABEL, addGroup, archiveMember, choiceLabel, contextLabel, deleteGroup,
  displayPath, dshDefaultLabel, effortLabel, effortsFor, groupModelLabel, modelKey, modelLabel, modelName, parseModelKey,
  presetLabel, presetName, relativeTime, removeMember, setLabel, updateGroup, updateMember,
} from '../model.ts';
import { Card, Collapse, ConfirmDialog, CountTag, Empty, Fact, PersonAvatar, PersonDialog, Select } from './ui.tsx';

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
 */
export function GroupsCard({ state, error, disabled, refreshing, onRefresh, onChanged }: {
  state: BridgeStateView | undefined;
  error?: string;
  disabled: boolean;
  refreshing: boolean;
  onRefresh(): void;
  onChanged(): void;
}) {
  const { busy, error: applyError, apply } = useRoutingApply(onChanged);
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
        <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} disabled={refreshing} onClick={onRefresh}>
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

function GroupPanel({ group, state, startEditing, disabled, onApply }: {
  group: GroupView;
  state: BridgeStateView | undefined;
  startEditing: boolean;
  disabled: boolean;
  onApply(key: string, ops: RoutingOp[]): Promise<unknown>;
}) {
  const [open, setOpen] = useState(startEditing);
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState<GroupDraft>(() => draftOf(group));
  const [confirming, setConfirming] = useState(false);
  const catalog = state?.models;
  const presets = state?.presets;
  const workspaces: readonly WorkspaceOption[] = state?.workspaces ?? [];
  const key = `group:${group.id}`;
  const effort = group.reasoningEffort ? ` · ${effortLabel(catalog, {
    provider: group.provider || group.effectiveProvider, model: group.model || group.effectiveModel,
    reasoningEffort: group.reasoningEffort,
  })}` : '';

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
      summary={`${group.memberCount} 位成员 · ${group.workspaceTitle} · ${groupModelLabel(catalog, group)}${effort}`}
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
          <Button variant="ghost" size="sm" disabled={disabled} aria-label={`编辑 ${group.name}`} onClick={startEdit}>
            编辑
          </Button>
        )}
        {!group.isDefault && (confirming ? (
          <>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirming(false)}>取消</Button>
            <Button
              variant="ghost" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled}
              onClick={() => { void onApply(key, [deleteGroup(group.id)]); }}
            >
              确认删除
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled} onClick={() => setConfirming(true)}>
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
          更换 Workspace 后，本组成员的会话会在下一条消息时重新创建。模型与 effort 在下一条消息时安装到已有会话；
          preset 只影响此后新建的会话（DSH 不允许改写已经开始的会话）。
        </div>
      )}

      <div className="wcb-members">
        {group.members.length === 0
          ? <Empty>这个分组还没有成员。让对方先给机器人发一条消息，然后在「未授权用户」里把 TA 加入本组。</Empty>
          : group.members.map(member => (
            <MemberRow
              key={member.key}
              member={member}
              group={group}
              groups={state?.routing?.groups ?? []}
              state={state}
              disabled={disabled}
              onApply={onApply}
            />
          ))}
      </div>
    </Collapse>
  );
}

/**
 * One member, on one line: the badge opens the person's dialog, the name and
 * the Session's five facts are read-only, and 归档会话 is the single action.
 */
function MemberRow({ member, group, groups, state, disabled, onApply }: {
  member: GroupMemberView;
  group: GroupView;
  groups: readonly GroupView[];
  state: BridgeStateView | undefined;
  disabled: boolean;
  onApply(key: string, ops: RoutingOp[]): Promise<unknown>;
}) {
  const [details, setDetails] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const catalog = state?.models;
  const presets = state?.presets;
  const others = groups.filter(item => item.id !== group.id);
  const effort = effortLabel(catalog, member.sessionModel);
  const name = member.displayName;
  const title = member.sessionId ? member.sessionTitle ?? '未命名会话' : '待创建';

  return (
    <div className="wcb-member-row">
      <PersonAvatar kind={member.kind} label={`${name} 的详情`} disabled={disabled} onClick={() => setDetails(true)} />
      <span className="wcb-member-name" title={name}>{name}</span>
      {member.admin && <Tag tone="success">管理员</Tag>}

      <span className="wcb-member-facts">
        <span className="wcb-fact-inline">
          {member.sessionId && <StateDot state={member.sessionRunning ? 'ongoing' : 'done'} size={8} />}
          <span className="wcb-fact-strong">{title}</span>
          {member.sessionId && (
            <Tag tone={member.sessionState === 'bound' || member.sessionState === 'blank' ? 'quiet' : 'warning'}>
              {SESSION_STATE_LABEL[member.sessionState]}
            </Tag>
          )}
        </span>
        <span className="wcb-fact-inline"><span className="wcb-fact-key">preset</span>{presetLabel(presets, member.sessionPreset)}</span>
        <span className="wcb-fact-inline"><span className="wcb-fact-key">模型</span>{member.sessionModel ? modelName(catalog, member.sessionModel) : '—'}</span>
        <span className="wcb-fact-inline"><span className="wcb-fact-key">effort</span>{effort || '—'}</span>
        <span className="wcb-fact-inline"><span className="wcb-fact-key">上下文</span>{contextLabel(member.sessionContext) || '—'}</span>
      </span>

      <span className="wcb-member-actions">
        {member.sessionId && (
          <Button
            variant="ghost" size="sm" disabled={disabled} aria-label={`归档 ${name} 的会话`}
            onClick={() => setArchiving(true)}
          >
            归档会话
          </Button>
        )}
      </span>

      <PersonDialog
        open={details}
        onClose={() => setDetails(false)}
        title={name}
        typeLabel={BINDING_KIND_LABEL[member.kind]}
        id={member.id}
        label={member.label}
        noteLabel={`${member.id} 的备注`}
        disabled={disabled}
        onNote={next => { void onApply(member.key, [setLabel(member.key, next)]); }}
        footer={<RemoveMember member={member} disabled={disabled} onApply={onApply} />}
      >
        <div className="wcb-dialog-section wcb-person-facts">
          <Fact name="所属分组">{group.name}</Fact>
          <Fact name="会话">
            {member.sessionId
              ? <>{member.sessionTitle ?? '未命名会话'} <span className="wcb-mono">{member.sessionId.slice(-8)}</span></>
              : '尚未创建'}
          </Fact>
          <Fact name="preset">{presetLabel(presets, member.sessionPreset)}</Fact>
          <Fact name="模型">{member.sessionModel ? modelLabel(catalog, member.sessionModel) : '—'}</Fact>
          <Fact name="effort">{effort || '—'}</Fact>
          <Fact name="上下文">{contextLabel(member.sessionContext) || '—'}</Fact>
          <Fact name="消息">{member.messages ? `${member.messages} 条 · ${relativeTime(member.lastSeenAt)}` : '尚未收到消息'}</Fact>
        </div>

        {others.length > 0 && (
          <label className="wcb-binding-field">
            <span className="wcb-binding-label">移动到分组</span>
            <Select
              value=""
              disabled={disabled}
              aria-label={`把 ${member.id} 移动到分组`}
              onChange={event => {
                if (!event.target.value) return;
                void onApply(member.key, [updateMember(member.key, { groupId: event.target.value })]);
              }}
            >
              <option value="">保持在「{group.name}」</option>
              {others.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
        )}
      </PersonDialog>

      <ConfirmDialog
        open={archiving}
        title={`归档「${name}」的会话？`}
        confirmLabel="确认归档"
        disabled={disabled}
        onCancel={() => setArchiving(false)}
        onConfirm={() => {
          void Promise.resolve(onApply(member.key, [archiveMember(member.key)])).then(result => {
            if (result) setArchiving(false);
          });
        }}
      >
        <p>
          归档后这个会话不再被继续，它的历史不会再进入任何请求；下一条消息会按分组当前的 Workspace、模型与 preset
          新建一个会话。DSH 的会话文件仍保留在磁盘上，需要时可到 DSH 页面查看。
        </p>
      </ConfirmDialog>
    </div>
  );
}

/** 移出分组, with its own confirmation step, inside the details dialog. */
function RemoveMember({ member, disabled, onApply }: {
  member: GroupMemberView;
  disabled: boolean;
  onApply(key: string, ops: RoutingOp[]): Promise<unknown>;
}) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirming(false)}>取消</Button>
      <Button
        variant="ghost" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled}
        onClick={() => { void onApply(member.key, [removeMember(member.key)]); }}
      >
        确认移出「{member.displayName}」
      </Button>
    </>
  ) : (
    <Button variant="ghost" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled} onClick={() => setConfirming(true)}>
      移出分组
    </Button>
  );
}
