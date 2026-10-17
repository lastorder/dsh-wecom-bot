import { useState } from 'react';
import {
  Button, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconTrashOutlineRegular,
  IconUserOutlineRegular, IconUsersOutlineRegular, Input, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type {
  BindingKind, BridgeStateView, GroupMemberView, GroupView, RoutingOp, WorkspaceOption,
} from '../../shared/protocol.ts';
import { useRoutingApply } from '../hooks.ts';
import {
  BINDING_KIND_LABEL, SESSION_STATE_LABEL, addGroup, addMember, choiceLabel, deleteGroup, displayPath,
  dshDefaultLabel, effortsFor, groupModelLabel, modelKey, modelLabel, parseModelKey, relativeTime,
  removeMember, sessionOptions, setLabel, updateGroup, updateMember,
} from '../model.ts';
import { Card, Collapse, CountTag, Empty, PersonFacts, PersonRow, Select } from './ui.tsx';

/**
 * Step 2: user groups. A group owns a Workspace and a model; its members are
 * the WeCom users (private chats) and group chats that may talk to the Bot.
 * The built-in 「默认分组」 cannot be deleted and holds whatever the old
 * 「默认 Workspace」 card configured.
 *
 * Every card is collapsed to one summary line until it is clicked, its
 * Workspace/model controls appear only after 编辑 is pressed, and every edit
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
      description="每个分组决定成员在哪个 Workspace、用哪个模型；把企微用户或群聊放进分组即为授权。改动即时生效，不需要点「保存配置」。"
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
  const workspaces: readonly WorkspaceOption[] = state?.workspaces ?? [];
  const model = group.provider && group.model ? { provider: group.provider, model: group.model } : undefined;
  const efforts = effortsFor(catalog, group.provider || group.effectiveProvider, group.model || group.effectiveModel);
  const key = `group:${group.id}`;

  /** The config only appears on demand, and asking for it also opens the card. */
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
      summary={`${group.memberCount} 位成员 · ${group.workspaceTitle} · ${groupModelLabel(catalog, group)}`}
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

          {efforts.length > 0 && (
            <label className="wcb-binding-field wcb-binding-field-narrow">
              <span className="wcb-binding-label">思考强度</span>
              <Select
                value={group.reasoningEffort ?? ''}
                disabled={disabled}
                aria-label={`${group.name} 的思考强度`}
                onChange={event => {
                  const selection = model ?? (group.effectiveProvider && group.effectiveModel
                    ? { provider: group.effectiveProvider, model: group.effectiveModel }
                    : undefined);
                  if (!selection) return;
                  void onApply(key, [updateGroup(group.id, {
                    provider: selection.provider, model: selection.model, reasoningEffort: event.target.value,
                  })], '思考强度');
                }}
              >
                <option value="">默认</option>
                {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
              </Select>
            </label>
          )}
        </div>
      )}

      {group.workspaceError && <div className="wcb-hint wcb-inline-error">{group.workspaceError}</div>}
      {editing && <div className="wcb-hint">更换 Workspace 后，本组成员的会话会在下一条消息时重新创建。</div>}

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
 * One member: the row shows the note (or the id when there is none), and
 * clicking it opens the details — type, id, editable note, the Session it owns
 * and the way out of the group.
 */
function MemberRow({ member, group, groups, state, disabled, onApply }: {
  member: GroupMemberView;
  group: GroupView;
  groups: readonly GroupView[];
  state: BridgeStateView | undefined;
  disabled: boolean;
  onApply(key: string, ops: RoutingOp[], label: string): Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const catalog = state?.models;
  const options = sessionOptions(member, group, state?.sessions?.groups);
  const others = groups.filter(item => item.id !== group.id);

  return (
    <PersonRow
      open={open}
      onToggle={() => setOpen(value => !value)}
      icon={member.kind === 'group' ? <IconUsersOutlineRegular size={15} /> : <IconUserOutlineRegular size={15} />}
      kind={<Tag tone={member.kind === 'group' ? 'warning' : 'info'}>{BINDING_KIND_LABEL[member.kind]}</Tag>}
      title={member.displayName}
      toggleLabel={`${member.displayName} 的详情`}
      meta={<>
        {member.admin && <Tag tone="success">管理员</Tag>}
        <span className="wcb-row-sub">
          {member.messages ? `${member.messages} 条消息 · ${relativeTime(member.lastSeenAt)}` : '尚未收到消息'}
        </span>
      </>}
    >
      <PersonFacts
        kind={BINDING_KIND_LABEL[member.kind]}
        id={member.id}
        label={member.label}
        disabled={disabled}
        noteLabel={`${member.id} 的备注`}
        onNote={next => { void onApply(member.key, [setLabel(member.key, next)], '备注'); }}
      />

      <div className="wcb-member-foot">
        <span className="wcb-row-sub">
          {member.sessionId
            ? <>
              <StateDot state={member.sessionRunning ? 'ongoing' : 'done'} size={10} />
              {member.sessionTitle ?? '未命名会话'}
              <span className="wcb-mono">{member.sessionId}</span>
              <Tag tone={member.sessionState === 'bound' || member.sessionState === 'blank' ? 'quiet' : 'warning'}>
                {SESSION_STATE_LABEL[member.sessionState]}
              </Tag>
            </>
            : '还没有专属会话，收到消息时会自动创建。'}
        </span>
        <span className="wcb-row-meta">
          {member.sessionModel && <Tag tone="quiet">实际使用 {modelLabel(catalog, member.sessionModel)}</Tag>}
        </span>
      </div>

      <div className="wcb-member-edit">
        <label className="wcb-binding-field">
          <span className="wcb-binding-label">DSH 会话</span>
          <Select
            value={member.sessionId}
            disabled={disabled}
            aria-label={`${member.id} 的会话`}
            onChange={event => { void onApply(member.key, [updateMember(member.key, { sessionId: event.target.value })], '会话'); }}
          >
            <option value="">自动（下一条消息时创建）</option>
            {options.map(option => (
              <option key={option.sessionId} value={option.sessionId}>
                {option.title ?? '未命名会话'} — {option.sessionId.slice(-8)}{option.stale ? '（当前不可见）' : ''}
              </option>
            ))}
          </Select>
        </label>

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

        <div className="wcb-member-actions">
          {member.sessionId && (
            <Button
              variant="ghost" size="sm" disabled={disabled}
              onClick={() => { void onApply(member.key, [updateMember(member.key, { sessionId: '' })], '换新会话'); }}
            >
              换新会话
            </Button>
          )}
          {confirming ? (
            <>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirming(false)}>取消</Button>
              <Button
                variant="ghost" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled}
                onClick={() => { void onApply(member.key, [removeMember(member.key)], '移出分组'); }}
              >
                确认移出
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled} onClick={() => setConfirming(true)}>
              移出分组
            </Button>
          )}
        </div>
      </div>
    </PersonRow>
  );
}
