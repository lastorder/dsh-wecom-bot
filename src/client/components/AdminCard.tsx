import { useState } from 'react';
import {
  Button, IconPlusOutlineRegular, IconShieldOutlineRegular, IconTrashOutlineRegular, IconUserOutlineRegular, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { AdminView, WorkspaceOption } from '../../shared/protocol.ts';
import { useRoutingApply } from '../hooks.ts';
import { displayPath, personKey, setAll, setLabel, toggle } from '../model.ts';
import { Card, CheckRow, Collapse, Empty, PersonFacts, PersonRow, Select } from './ui.tsx';

/**
 * Step 4: administrators. This is the one place that grants the power to leave
 * one's own Session: administrators may switch Sessions with `/sessions` +
 * `/use`, and receive notifications for the Workspaces they subscribe to.
 *
 * Administrators are also always allowed to message the Bot (they are trusted
 * from the Config), so a fresh install is never locked out of its own Bot.
 * The list itself is Config (it needs 保存配置); a person's 备注 is routing
 * state and applies immediately, exactly like a group member's.
 */
export function AdminCard({ draft, admins, workspaces, disabled, onChange, onChanged }: {
  draft: { adminUserIds: readonly string[]; adminWorkspaces: readonly string[] };
  admins: readonly AdminView[];
  workspaces: readonly WorkspaceOption[];
  disabled: boolean;
  onChange(patch: { adminUserIds?: string[]; adminWorkspaces?: string[] }): void;
  onChanged(): void;
}) {
  const [adding, setAdding] = useState(false);
  const [manual, setManual] = useState('');
  const [scopeOpen, setScopeOpen] = useState(false);
  const { busy, feedback, apply } = useRoutingApply(onChanged);
  const all = draft.adminWorkspaces.length === 0;
  // A Workspace whose Sessions are all archived can never notify anybody, so it
  // is not offered at all; the ones that remain show their live count.
  const visible = workspaces.filter(workspace => workspace.sessionCount > 0 || workspace.archivedSessionCount === 0);
  const pending = new Set(visible.map(workspace => workspace.path));
  const known = new Map(admins.map(admin => [admin.id, admin]));

  const add = (): void => {
    const id = manual.trim();
    if (!id) return;
    onChange({ adminUserIds: toggle(draft.adminUserIds, id, true) });
    setManual('');
    setAdding(false);
  };

  return (
    <Card
      step={4}
      title="管理员"
      description="只有这里列出的 userid 可以切换会话（/sessions、/use）、引用通知跳转，并按下面的范围接收通知。其它用户永远只能访问自己专属的会话。"
      aside={draft.adminUserIds.length
        ? <Tag tone={all ? 'warning' : 'success'}>{draft.adminUserIds.length} 人 · {all ? '全部 Workspace' : `${draft.adminWorkspaces.length} 个 Workspace`}</Tag>
        : <Tag tone="quiet">未设置</Tag>}
    >
      {feedback && (
        <div className="wcb-banner" data-tone={feedback.tone === 'ok' ? 'success' : 'danger'} role="status">
          <div><div className="wcb-banner-body">{feedback.text}</div></div>
        </div>
      )}

      <div className="wcb-panel">
        {draft.adminUserIds.length === 0 ? (
          <div style={{ padding: 10 }}><Empty>还没有管理员：没有人可以切换会话或接收他人会话的通知。</Empty></div>
        ) : (
          <div className="wcb-panel-scroll">
            {draft.adminUserIds.map(id => (
              <AdminRow
                key={id}
                id={id}
                label={known.get(id)?.label ?? ''}
                groupName={known.get(id)?.groupName}
                disabled={disabled || busy === personKey('user', id)}
                onNote={next => { void apply(personKey('user', id), [setLabel(personKey('user', id), next)], '备注'); }}
                onRemove={() => onChange({ adminUserIds: toggle(draft.adminUserIds, id, false) })}
              />
            ))}
          </div>
        )}

        {adding ? (
          <div className="wcb-add">
            <Input
              className="wcb-grow"
              value={manual}
              autoFocus
              placeholder="管理员 userid"
              aria-label="新增管理员 userid"
              disabled={disabled}
              onChange={event => setManual(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') { setAdding(false); setManual(''); }
                if (event.key === 'Enter') { event.preventDefault(); add(); }
              }}
            />
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { setAdding(false); setManual(''); }}>取消</Button>
            <Button variant="outline" size="sm" disabled={disabled || !manual.trim()} onClick={add}>添加</Button>
          </div>
        ) : (
          <div className="wcb-add">
            <Button variant="outline" size="sm" icon={<IconPlusOutlineRegular />} disabled={disabled} onClick={() => setAdding(true)}>
              添加管理员
            </Button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <Collapse
          open={scopeOpen}
          onToggle={() => setScopeOpen(value => !value)}
          title={<><IconShieldOutlineRegular size={15} /> 可接收通知的 Workspace</>}
          summary={all
            ? '全部 Workspace（会比较吵）'
            : `${draft.adminWorkspaces.length} / ${visible.length || draft.adminWorkspaces.length} 个 Workspace`}
          actions={draft.adminWorkspaces.length > 0
            ? <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange({ adminWorkspaces: [] })}>改为全部</Button>
            : undefined}
        >
          {visible.length === 0 ? (
            <Empty>还没有可接收通知的 Workspace。默认分组的 Workspace 会在创建会话时注册。</Empty>
          ) : (
            <div className="wcb-panel">
              <div className="wcb-panel-scroll">
                {visible.map(workspace => (
                  <CheckRow
                    key={workspace.path}
                    checked={draft.adminWorkspaces.includes(workspace.path)}
                    label={`管理员接收 ${workspace.title} 的通知`}
                    disabled={disabled}
                    onToggle={on => onChange({ adminWorkspaces: toggle(draft.adminWorkspaces, workspace.path, on) })}
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
                    ? '当前未限定：管理员会收到所有这些 Workspace 中会话的通知。'
                    : '管理员只接收已勾选 Workspace 中会话的通知（外加他们自己绑定的会话）。'}
                  {' '}已归档的会话不计入；只有归档会话的 Workspace 不会列出。
                </span>
                <button type="button" className="wcb-link" disabled={disabled}
                  onClick={() => onChange({ adminWorkspaces: setAll(draft.adminWorkspaces, [...pending], true) })}>
                  全选
                </button>
                <button type="button" className="wcb-link" disabled={disabled} onClick={() => onChange({ adminWorkspaces: [] })}>
                  清空（= 全部）
                </button>
              </div>
            </div>
          )}
        </Collapse>
      </div>
    </Card>
  );
}

/** One administrator: the row shows the note (or the userid), details on click. */
function AdminRow({ id, label, groupName, disabled, onNote, onRemove }: {
  id: string;
  label: string;
  groupName?: string;
  disabled: boolean;
  onNote(next: string): void;
  onRemove(): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <PersonRow
      open={open}
      onToggle={() => setOpen(value => !value)}
      icon={<IconUserOutlineRegular size={15} />}
      kind={<Tag tone="success">管理员</Tag>}
      title={label || id}
      toggleLabel={`${label || id} 的详情`}
      meta={<span className="wcb-row-sub">{groupName ? `分组：${groupName}` : '不在任何分组'}</span>}
      actions={(
        <Button
          variant="ghost" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled}
          aria-label={`移除管理员 ${id}`} onClick={onRemove}
        >
          移除
        </Button>
      )}
    >
      <PersonFacts
        kind="管理员（个人 userid）"
        id={id}
        label={label}
        disabled={disabled}
        noteLabel={`管理员 ${id} 的备注`}
        onNote={onNote}
      />
      <div className="wcb-hint">备注即时生效，会代替 userid 显示。移除管理员属于插件设置，需要点「保存配置」才生效。</div>
    </PersonRow>
  );
}
