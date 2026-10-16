import { IconShieldOutlineRegular, IconUserOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ObservedIdentities, WorkspaceOption } from '../../shared/protocol.ts';
import { displayPath, setAll, toggle } from '../model.ts';
import { IdListPanel } from './IdListPanel.tsx';
import { Card, CheckRow, Empty } from './ui.tsx';

/**
 * Step 5: administrators. This is the one place that grants the power to
 * leave one's own Session: administrators may switch Sessions with
 * `/sessions` + `/use` and receive notifications for the Workspaces listed
 * here.
 */
export function AdminCard({ draft, observed, workspaces, disabled, onChange }: {
  draft: { adminUserIds: readonly string[]; adminWorkspaces: readonly string[] };
  observed: ObservedIdentities | undefined;
  workspaces: readonly WorkspaceOption[];
  disabled: boolean;
  onChange(patch: { adminUserIds?: string[]; adminWorkspaces?: string[] }): void;
}) {
  const all = draft.adminWorkspaces.length === 0;
  return (
    <Card
      step={5}
      title="管理员"
      description="只有这里列出的 userid 可以切换会话（/sessions、/use）并接收通知。其它用户永远只能访问自己专属的会话。"
      aside={draft.adminUserIds.length
        ? <Tag tone={all ? 'warning' : 'success'}>{draft.adminUserIds.length} 人 · {all ? '全部 Workspace' : `${draft.adminWorkspaces.length} 个 Workspace`}</Tag>
        : <Tag tone="quiet">未设置</Tag>}
    >
      <IdListPanel
        kind="users"
        title="管理员 userid"
        hint="可多人"
        icon={<IconUserOutlineRegular size={16} />}
        observed={observed?.users ?? []}
        selected={draft.adminUserIds}
        disabled={disabled}
        placeholder="手动添加 userid"
        verb="管理员"
        empty="还没有收到过消息。也可以手动填写 userid。"
        onChange={next => onChange({ adminUserIds: next })}
      />
      <div className="wcb-subhead" style={{ marginTop: 16 }}>
        <IconShieldOutlineRegular size={16} />
        <span className="wcb-subhead-title">可接收通知的 Workspace</span>
        <span className="wcb-subhead-hint">留空 = 全部 Workspace</span>
        <span className="wcb-card-aside">
          {draft.adminWorkspaces.length > 0 && (
            <button type="button" className="wcb-link" disabled={disabled} onClick={() => onChange({ adminWorkspaces: [] })}>
              改为全部
            </button>
          )}
        </span>
      </div>
      <div className="wcb-panel">
        {workspaces.length === 0 ? (
          <div style={{ padding: 10 }}>
            <Empty>还没有注册的 Workspace。保存默认 Workspace 后这里会列出可供选择的工作区。</Empty>
          </div>
        ) : (
          <div className="wcb-panel-scroll">
            {workspaces.map(workspace => (
              <CheckRow
                key={workspace.path}
                checked={draft.adminWorkspaces.includes(workspace.path)}
                label={`管理员接收 ${workspace.title} 的通知`}
                disabled={disabled}
                onToggle={on => onChange({ adminWorkspaces: toggle(draft.adminWorkspaces, workspace.path, on) })}
                meta={<span className="wcb-row-meta">{workspace.sessionCount} 个会话</span>}
              >
                <span className="wcb-row-title">{workspace.title}</span>
                <span className="wcb-row-sub wcb-mono wcb-ellipsis" title={workspace.path}>{displayPath(workspace.path)}</span>
              </CheckRow>
            ))}
          </div>
        )}
        {workspaces.length > 0 && (
          <div className="wcb-add">
            <span className="wcb-grow wcb-hint">
              {all
                ? '当前未限定：管理员会收到所有 Workspace 中会话的通知。'
                : '管理员只接收已勾选 Workspace 中会话的通知（外加他们自己绑定的会话）。'}
            </span>
            <button type="button" className="wcb-link" disabled={disabled}
              onClick={() => onChange({ adminWorkspaces: setAll(draft.adminWorkspaces, workspaces.map(workspace => workspace.path), true) })}>
              全选
            </button>
            <button type="button" className="wcb-link" disabled={disabled}
              onClick={() => onChange({ adminWorkspaces: [] })}>
              清空（= 全部）
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
