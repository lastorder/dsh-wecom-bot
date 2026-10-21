import { useEffect, useMemo, useState } from 'react';
import {
  Button, IconPlusOutlineRegular, IconShieldOutlineRegular, IconTrashOutlineRegular, Input, Modal, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { BridgeStateView, GroupView } from '../../shared/protocol.ts';
import { useStoreApply, useStoreSettingsSave } from '../hooks.ts';
import { addMember, displayPath, personKey, scopeIncludes, setLabel, toggle, toggleScope } from '../model.ts';
import { Card, CheckRow, Collapse, Empty, Fact, PersonDialog, PersonRow, Select } from './ui.tsx';

/**
 * Step 4: administrators. This is the one place that grants the power to leave
 * one's own Session: administrators may switch Sessions with `/sessions` +
 * `/use`, pick the Workspace their commands default to, and are the only
 * recipients of tool-call approvals.
 *
 * Administrators are also always allowed to message the Bot, so a fresh install
 * is never locked out of its own Bot. The list and the notification scope are
 * the store's settings block, not the plugin Config: they live in the plugin's
 * own document, where a write is applied live and never rebuilds the bridge. So
 * adding, removing or re-scoping an administrator is a decision the operator has
 * already made by clicking, and this card writes on every edit with no 保存
 * button at all. A person's 备注 is routing state and applies immediately,
 * exactly like a group member's.
 */
export function AdminCard({ state, disabled, onChanged }: {
  state: BridgeStateView | undefined;
  disabled: boolean;
  onChanged(): void;
}) {
  const storedIds = state?.settings?.adminUserIds ?? [];
  const storedScope = state?.settings?.adminWorkspaces ?? [];
  const [draft, setDraft] = useState(() => ({ adminUserIds: [...storedIds], adminWorkspaces: [...storedScope] }));
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [scopeOpen, setScopeOpen] = useState(false);
  const save = useStoreSettingsSave(onChanged);
  const routing = useStoreApply(onChanged);
  const admins = state?.admins ?? [];
  const groups = state?.routing?.groups ?? [];
  const workspaces = state?.workspaces ?? [];
  const all = draft.adminWorkspaces.length === 0;
  const busy = disabled || save.saving;

  // Rebase on the store's own copy whenever its values move — but keyed by the
  // values, not by the polled object: a poll that answers with what this card
  // already shows must not undo an optimistic click while its write is in
  // flight. The separator keeps two lists from ever hashing alike.
  const storedKey = `${storedIds.join('\u0000')}\u0001${storedScope.join('\u0000')}`;
  useEffect(() => {
    setDraft({ adminUserIds: [...storedIds], adminWorkspaces: [...storedScope] });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the two lists
  }, [storedKey]);

  /**
   * Write one edit now. The draft follows the click immediately — a checkbox
   * must not lag behind the pointer — and the arrays come back from the store
   * when the write fails, so the card never shows a change that was not saved.
   * Only the array that moved is part of the patch.
   */
  const apply = async (patch: Partial<{ adminUserIds: string[]; adminWorkspaces: string[] }>): Promise<void> => {
    setDraft(current => ({ ...current, ...patch }));
    if (!(await save.save(patch))) {
      setDraft({ adminUserIds: [...storedIds], adminWorkspaces: [...storedScope] });
    }
  };

  const known = new Map(admins.map(admin => [admin.id, admin]));

  /** People the operator already knows about, best name first. */
  const candidates = useMemo(() => {
    const rows = new Map<string, { id: string; name: string; hint: string }>();
    for (const sender of state?.rejected ?? []) {
      if (sender.kind !== 'user') continue;
      rows.set(sender.id, {
        id: sender.id,
        name: sender.label || sender.id,
        hint: sender.label ? `未授权用户 · ${sender.id}` : '未授权用户（刚给机器人发过消息）',
      });
    }
    for (const group of state?.routing?.groups ?? []) {
      for (const member of group.members) {
        if (member.kind !== 'user') continue;
        rows.set(member.id, {
          id: member.id,
          name: member.displayName,
          hint: member.label ? `分组：${group.name} · ${member.id}` : `分组：${group.name}`,
        });
      }
    }
    for (const id of draft.adminUserIds) rows.delete(id);
    return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [state, draft.adminUserIds]);

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? candidates.filter(row => row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle))
    : candidates;
  const typed = query.trim();

  const addAdmin = (id: string): void => {
    void apply({ adminUserIds: toggle(draft.adminUserIds, id, true) });
    setQuery('');
    setPicking(false);
  };

  return (
    <Card
      step={4}
      title="管理员"
      description="只有这里列出的 userid 可以切换会话（/sessions、/use、/new、/workspaces）、在单聊里审批工具调用，并按下面的范围接收通知。其它用户永远只能访问自己专属的会话。改动即时生效。"
      aside={<>
        {draft.adminUserIds.length > 0 && <Tag tone="success">{draft.adminUserIds.length} 人</Tag>}
        <Button
          variant="outline" size="sm" icon={<IconPlusOutlineRegular />} disabled={busy}
          aria-label="添加管理员" onClick={() => setPicking(true)}
        >
          添加
        </Button>
      </>}
    >
      {routing.error && (
        <div className="wcb-banner" data-tone="danger" role="status">
          <div><div className="wcb-banner-body">{routing.error}</div></div>
        </div>
      )}
      {save.error && (
        <div className="wcb-banner" data-tone="danger" role="status">
          <div><div className="wcb-banner-body">{save.error}</div></div>
        </div>
      )}

      <div className="wcb-panel">
        {draft.adminUserIds.length === 0 ? (
          <div style={{ padding: 10 }}>
            <Empty>
              还没有管理员：没有人可以切换会话、审批工具调用或接收他人会话的通知。
              <div style={{ marginTop: 10 }}>
                <Button variant="outline" size="sm" icon={<IconPlusOutlineRegular />} disabled={busy} onClick={() => setPicking(true)}>
                  添加管理员
                </Button>
              </div>
            </Empty>
          </div>
        ) : (
          <div className="wcb-panel-scroll">
            {draft.adminUserIds.map(id => (
              <AdminRow
                key={id}
                id={id}
                label={known.get(id)?.label ?? ''}
                groupName={known.get(id)?.groupName}
                groups={groups}
                disabled={busy || routing.busy === personKey('user', id)}
                onAssign={groupId => routing.apply(personKey('user', id), [addMember(groupId, 'user', id)])}
                onNote={next => { void routing.apply(personKey('user', id), [setLabel(personKey('user', id), next)]); }}
                onRemove={() => { void apply({ adminUserIds: toggle(draft.adminUserIds, id, false) }); }}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <Collapse
          open={scopeOpen}
          onToggle={() => setScopeOpen(value => !value)}
          title={<><IconShieldOutlineRegular size={15} /> 可接收通知的 Workspace</>}
          summary={all ? '全部 Workspace' : `${draft.adminWorkspaces.length} / ${workspaces.length || draft.adminWorkspaces.length} 个 Workspace`}
          actions={all ? undefined : (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => { void apply({ adminWorkspaces: [] }); }}>
              全选
            </Button>
          )}
        >
          {workspaces.length === 0 ? (
            <Empty>还没有注册任何 Workspace。默认分组的 Workspace 会在创建会话时注册。</Empty>
          ) : (
            <div className="wcb-panel">
              <div className="wcb-panel-scroll">
                {workspaces.map(workspace => (
                  <CheckRow
                    key={workspace.path}
                    checked={scopeIncludes(draft.adminWorkspaces, workspace.path)}
                    label={`管理员接收 ${workspace.title} 的通知`}
                    disabled={busy}
                    onToggle={on => {
                      void apply({
                        adminWorkspaces: toggleScope(draft.adminWorkspaces, workspaces.map(item => item.path), workspace.path, on),
                      });
                    }}
                    meta={<span className="wcb-row-meta">{workspace.sessionCount ? `${workspace.sessionCount} 个会话` : '暂无会话'}</span>}
                  >
                    <span className="wcb-row-title">{workspace.title}</span>
                    <span className="wcb-row-sub wcb-mono wcb-ellipsis" title={workspace.path}>{displayPath(workspace.path)}</span>
                  </CheckRow>
                ))}
              </div>
              <div className="wcb-add">
                <span className="wcb-grow wcb-hint">
                  {all
                    ? '未限定（全部勾选）：管理员会收到所有这些 Workspace 中会话的通知。取消勾选任意一项即改为只收勾选的 Workspace。'
                    : '管理员只接收已勾选 Workspace 中会话的通知（外加他们自己绑定的会话）。'}
                  {' '}只有归档会话的 Workspace 也会列出。勾选即生效。
                </span>
              </div>
            </div>
          )}
        </Collapse>
      </div>

      <Modal
        open={picking} onClose={() => setPicking(false)} title="添加管理员" closeLabel="关闭"
        className="wcb-modal" contentClassName="wcb-modal-content"
      >
        <Input
          value={query}
          autoFocus
          placeholder="搜索备注名或企微 userid"
          aria-label="搜索已知用户"
          onChange={event => setQuery(event.target.value)}
        />
        {matches.length > 0 && (
          <div className="wcb-picker-list" role="listbox" aria-label="已知用户">
            {matches.map(row => (
              <button
                key={row.id} type="button" className="wcb-picker-row" role="option" aria-selected={false}
                onClick={() => addAdmin(row.id)}
              >
                <span className="wcb-row-title">{row.name}</span>
                <span className="wcb-picker-hint">{row.hint}</span>
              </button>
            ))}
          </div>
        )}
        {typed && !candidates.some(row => row.id === typed) && (
          <div className="wcb-picker-row" data-manual>
            <span className="wcb-row-title">直接添加「{typed}」</span>
            <span className="wcb-picker-hint">按 userid 添加一个还没给机器人发过消息的人</span>
            <Button variant="outline" size="sm" onClick={() => addAdmin(typed)}>添加</Button>
          </div>
        )}
        <div className="wcb-hint">
          名单来自未授权用户和已授权成员，优先显示备注名；没有备注时显示企微 userid。选中即生效。
        </div>
      </Modal>
    </Card>
  );
}

/** The badge opens details; an unassigned administrator can explicitly join a group. */
function AdminRow({ id, label, groupName, groups, disabled, onAssign, onNote, onRemove }: {
  id: string;
  label: string;
  groupName?: string;
  groups: readonly Pick<GroupView, 'id' | 'name'>[];
  disabled: boolean;
  onAssign(groupId: string): Promise<unknown>;
  onNote(next: string): void;
  onRemove(): void;
}) {
  const [details, setDetails] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const name = label || id;
  return (
    <div className="wcb-member">
      <PersonRow
        kind="user"
        title={name}
        label={`${name} 的详情`}
        disabled={disabled}
        onOpen={() => setDetails(true)}
        meta={<>
          <Tag tone="success">管理员</Tag>
          {groupName ? <span className="wcb-row-sub">分组：{groupName}</span> : (
            <button
              type="button" className="wcb-link" disabled={disabled}
              aria-label={`为 ${name} 分配分组`} aria-expanded={assigning}
              onClick={() => setAssigning(value => !value)}
            >
              不在任何分组
            </button>
          )}
        </>}
      />
      {assigning && !groupName && (
        <div className="wcb-member-edit">
          <label className="wcb-binding-field">
            <span className="wcb-binding-label">加入分组</span>
            <Select
              value="" autoFocus disabled={disabled || !groups.length}
              aria-label={`管理员 ${id} 的分组`}
              onChange={event => {
                const groupId = event.target.value;
                if (!groupId) return;
                void onAssign(groupId).then(result => { if (result) setAssigning(false); });
              }}
            >
              <option value="" disabled>{groups.length ? '请选择分组' : '暂无可用分组'}</option>
              {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </Select>
            <span className="wcb-hint">选择后立即加入；下一条消息按该组的 Workspace、模型与 preset 创建会话，管理员权限不变。</span>
          </label>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setAssigning(false)}>取消</Button>
        </div>
      )}
      <PersonDialog
        open={details}
        onClose={() => setDetails(false)}
        title={name}
        typeLabel="管理员（个人 userid）"
        id={id}
        label={label}
        noteLabel={`管理员 ${id} 的备注`}
        disabled={disabled}
        onNote={onNote}
        footer={(
          <Button
            variant="outline" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled}
            aria-label={`移除管理员 ${id}`} onClick={onRemove}
          >
            移除管理员
          </Button>
        )}
      >
        <div className="wcb-person-facts">
          <Fact name="授权来源">插件设置里的管理员列表（改动即时生效）</Fact>
          <Fact name="所属分组">{groupName ?? '不在任何分组'}</Fact>
        </div>
        <div className="wcb-hint">备注与管理员名单都即时生效。</div>
      </PersonDialog>
    </div>
  );
}
