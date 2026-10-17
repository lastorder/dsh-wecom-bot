import { useState } from 'react';
import {
  Button, IconAgentPresetOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
  IconTrashOutlineRegular, Input, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type {
  BindingKind, BridgeStateView, GroupMemberView, GroupView, RoutingOp, WorkspaceOption,
} from '../../shared/protocol.ts';
import { useRoutingApply } from '../hooks.ts';
import {
  BINDING_KIND_LABEL, SESSION_STATE_LABEL, addGroup, addMember, choiceLabel, contextLabel, deleteGroup,
  displayPath, dshDefaultLabel, effortLabel, effortsFor, groupModelLabel, modelKey, modelLabel, parseModelKey,
  presetLabel, presetName, relativeTime, removeMember, sessionOptions, setLabel, updateGroup, updateMember,
} from '../model.ts';
import { Card, Collapse, CountTag, Empty, Fact, PersonDialog, PersonRow, Select } from './ui.tsx';

/**
 * Step 2: user groups. A group owns a Workspace, a model (with its effort) and
 * an agent preset; its members are the WeCom users (private chats) and group
 * chats that may talk to the Bot. The built-in 「默认分组」 cannot be deleted
 * and holds whatever the old 「默认 Workspace」 card configured.
 *
 * A group folds to one summary line until it is clicked, its settings appear
 * only after 编辑 is pressed, a member's details (type, id, 备注) open from its
 * colored badge, and its Session line is read-only until clicked. Every edit
 * applies immediately (the Host owns this state, not the Config form).
 */
export function GroupsCard({ state, error, disabled, refreshing, onRefresh, onChanged }: {
  state: BridgeStateView | undefined;
  error?: string;
  disabled: boolean;
  refreshing: boolean;
  onRefresh(): void;
  onChanged(): void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const { busy, feedback, apply } = useRoutingApply(onChanged);
  const view = state?.routing;

  return (
    <Card
      step={2}
      title="用户分组"
      description="每个分组决定成员在哪个 Workspace、用哪个模型与 preset；把企微用户或群聊放进分组即为授权。改动即时生效，不需要点「保存配置」。"
      aside={<>
        <CountTag count={view?.groups.length ?? 0} noun="个分组" tone="quiet" />
        <CountTag count={view?.total ?? 0} noun="位成员" />
      </>}
    >
      <div className="wcb-toolbar">
        <span className="wcb-grow wcb-hint">
          没有分组的用户无法与机器人对话；他们发消息后会出现在下一张「未授权用户」卡片里。
        </span>
        <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} disabled={refreshing} onClick={onRefresh}>
          {refreshing ? '刷新中' : '刷新'}
        </Button>
      </div>

      {feedback && (
        <div className="wcb-banner" data-tone={feedback.tone === 'ok' ? 'success' : 'danger'} role="status">
          <div><div className="wcb-banner-body">{feedback.text}</div></div>
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
              disabled={disabled || busy.startsWith(`group:${group.id}`)}
              onApply={apply}
            />
          ))}
        </div>
      )}

      {adding ? (
        <div className="wcb-add">
          <Input
            className="wcb-grow"
            value={newName}
            autoFocus
            placeholder="新分组的名字，例如：朋友、外部群"
            aria-label="新分组名称"
            disabled={disabled}
            onChange={event => setNewName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') { setAdding(false); setNewName(''); }
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void apply('group:new', [addGroup(newName.trim())], '新增分组').then(ok => {
                if (ok) { setAdding(false); setNewName(''); }
              });
            }}
          />
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { setAdding(false); setNewName(''); }}>取消</Button>
          <Button
            variant="outline" size="sm" icon={<IconPlusOutlineRegular />} disabled={disabled}
            onClick={() => { void apply('group:new', [addGroup(newName.trim())], '新增分组').then(ok => { if (ok) { setAdding(false); setNewName(''); } }); }}
          >
            创建
          </Button>
        </div>
      ) : (
        <div className="wcb-list-foot">
          <Button variant="outline" size="sm" icon={<IconPlusOutlineRegular />} disabled={disabled} onClick={() => setAdding(true)}>
            添加分组
          </Button>
          <span>分组与成员保存在 <span className="wcb-code">DSH home/wecom-bot/bindings.json</span>，重启后依然有效。</span>
        </div>
      )}
    </Card>
  );
}

function GroupPanel({ group, state, disabled, onApply }: {
  group: GroupView;
  state: BridgeStateView | undefined;
  disabled: boolean;
  onApply(key: string, ops: RoutingOp[], label: string): Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);
  const catalog = state?.models;
  const presets = state?.presets;
  const workspaces: readonly WorkspaceOption[] = state?.workspaces ?? [];
  const model = group.provider && group.model ? { provider: group.provider, model: group.model } : undefined;
  const efforts = effortsFor(catalog, group.provider || group.effectiveProvider, group.model || group.effectiveModel);
  const effort = group.reasoningEffort ? ` · ${effortLabel(catalog, {
    provider: group.provider || group.effectiveProvider, model: group.model || group.effectiveModel,
    reasoningEffort: group.reasoningEffort,
  })}` : '';
  const key = `group:${group.id}`;

  /** The settings only appear on demand, and asking for them also opens the card. */
  const toggleEditing = (): void => {
    if (editing) { setEditing(false); return; }
    setEditing(true);
    setOpen(true);
  };

  return (
    <Collapse
      open={open}
      onToggle={() => setOpen(value => !value)}
      title={<>{group.name}{group.isDefault && <Tag tone="quiet">默认</Tag>}</>}
      summary={`${group.memberCount} 位成员 · ${group.workspaceTitle} · ${groupModelLabel(catalog, group)}${effort}`}
      actions={<>
        <Button
          variant="ghost" size="sm" disabled={disabled} onClick={toggleEditing}
          aria-label={editing ? `收起 ${group.name} 的编辑` : `编辑 ${group.name}`}
        >
          {editing ? '收起编辑' : '编辑'}
        </Button>
        {!group.isDefault && (confirming ? (
          <>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirming(false)}>取消</Button>
            <Button
              variant="ghost" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled}
              onClick={() => { void onApply(key, [deleteGroup(group.id)], '删除分组'); }}
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
              key={group.name}
              defaultValue={group.name}
              disabled={disabled}
              aria-label={`${group.name} 的名称`}
              onBlur={event => {
                const next = event.target.value.trim();
                if (next && next !== group.name) void onApply(key, [updateGroup(group.id, { name: next })], '分组名称');
              }}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            />
          </label>

          <label className="wcb-binding-field">
            <span className="wcb-binding-label">Workspace</span>
            <Select
              value={group.workspace}
              disabled={disabled}
              aria-label={`${group.name} 的 Workspace`}
              onChange={event => { void onApply(key, [updateGroup(group.id, { workspace: event.target.value })], 'Workspace'); }}
            >
              <option value="">插件自带（{displayPath(state?.workspaces.find(workspace => workspace.pluginOwned)?.path)}）</option>
              {workspaces.map(workspace => (
                <option key={workspace.path} value={workspace.path}>
                  {workspace.title} — {displayPath(workspace.path)}
                </option>
              ))}
              {group.workspace && !workspaces.some(workspace => workspace.path === group.workspace) && (
                <option value={group.workspace}>{displayPath(group.workspace)}（未注册）</option>
              )}
            </Select>
          </label>

          <label className="wcb-binding-field">
            <span className="wcb-binding-label">模型</span>
            <Select
              value={modelKey(group.provider, group.model)}
              disabled={disabled || !catalog}
              aria-label={`${group.name} 的模型`}
              onChange={event => {
                const next = parseModelKey(event.target.value);
                void onApply(key, [updateGroup(group.id, { provider: next.provider, model: next.model, reasoningEffort: '' })], '模型');
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
              value={group.reasoningEffort ?? ''}
              disabled={disabled || !efforts.length}
              aria-label={`${group.name} 的 effort`}
              onChange={event => {
                const selection = model ?? (group.effectiveProvider && group.effectiveModel
                  ? { provider: group.effectiveProvider, model: group.effectiveModel }
                  : undefined);
                if (!selection) return;
                void onApply(key, [updateGroup(group.id, {
                  provider: selection.provider, model: selection.model, reasoningEffort: event.target.value,
                })], 'effort');
              }}
            >
              <option value="">默认</option>
              {efforts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>

          <label className="wcb-binding-field">
            <span className="wcb-binding-label">preset</span>
            <Select
              value={group.preset}
              disabled={disabled || !presets?.presets.length}
              aria-label={`${group.name} 的 preset`}
              onChange={event => { void onApply(key, [updateGroup(group.id, { preset: event.target.value })], 'preset'); }}
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
          ? <Empty>这个分组还没有成员。可以让对方先给机器人发消息，然后在「未授权用户」里加入本组；也可以手动添加。</Empty>
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

      <div className="wcb-list-foot">
        {adding ? (
          <AddMemberForm
            groupId={group.id}
            disabled={disabled}
            onCancel={() => setAdding(false)}
            onSubmit={(kind, id, label) => onApply(key, [addMember(group.id, kind, id, label)], '添加成员')
              .then(ok => { if (ok) setAdding(false); return ok; })}
          />
        ) : (
          <Button variant="outline" size="sm" icon={<IconPlusOutlineRegular />} disabled={disabled} onClick={() => setAdding(true)}>
            添加成员
          </Button>
        )}
      </div>
    </Collapse>
  );
}

function AddMemberForm({ groupId, disabled, onCancel, onSubmit }: {
  groupId: string;
  disabled: boolean;
  onCancel(): void;
  onSubmit(kind: BindingKind, id: string, label: string): Promise<boolean>;
}) {
  const [kind, setKind] = useState<BindingKind>('user');
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  return (
    <div className="wcb-add wcb-grow">
      <Select value={kind} disabled={disabled} aria-label={`新增到 ${groupId} 的类型`} onChange={event => setKind(event.target.value as BindingKind)}>
        <option value="user">个人（userid）</option>
        <option value="group">群聊（chatid）</option>
      </Select>
      <Input
        className="wcb-grow"
        value={id}
        autoFocus
        placeholder={kind === 'user' ? 'userid' : 'chatid'}
        aria-label="成员 ID"
        disabled={disabled}
        onChange={event => setId(event.target.value)}
      />
      <Input
        className="wcb-grow"
        value={label}
        placeholder="备注（可选）"
        aria-label="成员备注"
        disabled={disabled}
        onChange={event => setLabel(event.target.value)}
      />
      <Button variant="ghost" size="sm" disabled={disabled} onClick={onCancel}>取消</Button>
      <Button
        variant="outline" size="sm" disabled={disabled || !id.trim()}
        onClick={() => { void onSubmit(kind, id.trim(), label.trim()); }}
      >
        添加
      </Button>
    </div>
  );
}

/**
 * One member: a person line whose badge opens the details, and below it the
 * Session the person talks to — name, preset, model, effort and context
 * occupancy, all read-only until the line is clicked.
 */
function MemberRow({ member, group, groups, state, disabled, onApply }: {
  member: GroupMemberView;
  group: GroupView;
  groups: readonly GroupView[];
  state: BridgeStateView | undefined;
  disabled: boolean;
  onApply(key: string, ops: RoutingOp[], label: string): Promise<boolean>;
}) {
  const [details, setDetails] = useState(false);
  const catalog = state?.models;
  const presets = state?.presets;
  const others = groups.filter(item => item.id !== group.id);
  const effort = effortLabel(catalog, member.sessionModel);
  const name = member.displayName;

  return (
    <div className="wcb-member">
      <PersonRow
        kind={member.kind}
        title={name}
        label={`${name} 的详情`}
        disabled={disabled}
        onOpen={() => setDetails(true)}
        meta={<>
          {member.admin && <Tag tone="success">管理员</Tag>}
          <span className="wcb-row-sub">
            {member.messages ? `${member.messages} 条消息 · ${relativeTime(member.lastSeenAt)}` : '尚未收到消息'}
          </span>
        </>}
      />

      <SessionLine member={member} group={group} state={state} disabled={disabled} onApply={onApply} />

      <PersonDialog
        open={details}
        onClose={() => setDetails(false)}
        title={name}
        typeLabel={BINDING_KIND_LABEL[member.kind]}
        id={member.id}
        label={member.label}
        noteLabel={`${member.id} 的备注`}
        disabled={disabled}
        onNote={next => { void onApply(member.key, [setLabel(member.key, next)], '备注'); }}
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
                void onApply(member.key, [updateMember(member.key, { groupId: event.target.value })], '移动分组');
              }}
            >
              <option value="">保持在「{group.name}」</option>
              {others.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
        )}
      </PersonDialog>
    </div>
  );
}

/** 移出分组, with its own confirmation step, inside the details dialog. */
function RemoveMember({ member, disabled, onApply }: {
  member: GroupMemberView;
  disabled: boolean;
  onApply(key: string, ops: RoutingOp[], label: string): Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirming(false)}>取消</Button>
      <Button
        variant="ghost" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled}
        onClick={() => { void onApply(member.key, [removeMember(member.key)], '移出分组'); }}
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

/**
 * The Session one member owns, summarized in five facts: its name, the preset it
 * runs, the model and effort its last request used, and how full its context is.
 * Nothing here is a form — clicking the line reveals the Session picker, so the
 * group card reads as a report until the operator decides to change something.
 */
function SessionLine({ member, group, state, disabled, onApply }: {
  member: GroupMemberView;
  group: GroupView;
  state: BridgeStateView | undefined;
  disabled: boolean;
  onApply(key: string, ops: RoutingOp[], label: string): Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const catalog = state?.models;
  const presets = state?.presets;
  const options = sessionOptions(member, group, state?.sessions?.groups);
  const effort = effortLabel(catalog, member.sessionModel);
  const title = member.sessionId ? member.sessionTitle ?? '未命名会话' : '待创建';

  return (
    <div className="wcb-session-block">
      <button
        type="button" className="wcb-session" data-open={editing ? '' : undefined}
        aria-expanded={editing} aria-label={`${member.displayName} 的会话`} disabled={disabled}
        onClick={() => setEditing(value => !value)}
      >
        <span className="wcb-session-fact">
          <span className="wcb-session-key">会话</span>
          {member.sessionId && <StateDot state={member.sessionRunning ? 'ongoing' : 'done'} size={8} />}
          <span className="wcb-session-name">{title}</span>
          {member.sessionId && (
            <Tag tone={member.sessionState === 'bound' || member.sessionState === 'blank' ? 'quiet' : 'warning'}>
              {SESSION_STATE_LABEL[member.sessionState]}
            </Tag>
          )}
        </span>
        <span className="wcb-session-fact">
          <IconAgentPresetOutlineRegular size={11} className="wcb-session-icon" />
          <span className="wcb-session-key">preset</span>
          {presetLabel(presets, member.sessionPreset)}
        </span>
        <span className="wcb-session-fact">
          <span className="wcb-session-key">模型</span>
          {member.sessionModel ? modelLabel(catalog, member.sessionModel) : '—'}
        </span>
        <span className="wcb-session-fact">
          <span className="wcb-session-key">effort</span>
          {effort || '—'}
        </span>
        <span className="wcb-session-fact">
          <span className="wcb-session-key">上下文</span>
          {contextLabel(member.sessionContext) || '—'}
        </span>
      </button>

      {editing && (
        <div className="wcb-member-edit">
          <label className="wcb-binding-field">
            <span className="wcb-binding-label">DSH 会话</span>
            <Select
              value={member.sessionId}
              disabled={disabled}
              aria-label={`${member.id} 的会话选择`}
              onChange={event => {
                void onApply(member.key, [updateMember(member.key, { sessionId: event.target.value })], '会话');
              }}
            >
              <option value="">自动（下一条消息时创建）</option>
              {options.map(option => (
                <option key={option.sessionId} value={option.sessionId}>
                  {option.title ?? '未命名会话'} — {option.sessionId.slice(-8)}{option.stale ? '（当前不可见）' : ''}
                </option>
              ))}
            </Select>
          </label>
          <div className="wcb-member-actions">
            {member.sessionId && (
              <Button
                variant="ghost" size="sm" disabled={disabled}
                onClick={() => { void onApply(member.key, [updateMember(member.key, { sessionId: '' })], '换新会话'); }}
              >
                换新会话
              </Button>
            )}
          </div>
          <div className="wcb-hint wcb-session-hint">
            模型与 effort 由分组决定，下一条消息时安装到这个会话。
          </div>
        </div>
      )}
    </div>
  );
}
