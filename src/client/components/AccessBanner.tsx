import {
  IconCheckCircleOutlineRegular, IconShieldOutlineRegular, IconWarningTriangleOutlineRegular, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { AccessDimension, AccessSummary } from '../model.ts';

const DIMENSION_LABEL: Record<AccessDimension, string> = {
  chats: '企微会话：所有单聊与群聊',
  users: '企微用户：任何人',
};

/**
 * Prominent explanation of what an empty allowlist exposes. The DSH Session
 * dimension of the old release is gone: a non-admin can only ever reach the
 * Session bound to their own conversation, so the remaining risk is who may
 * run an agent in the plugin's Workspace at all.
 */
export function AccessBanner({ summary, admins, adminWorkspaces, workspace }: {
  summary: AccessSummary;
  admins: readonly string[];
  adminWorkspaces: readonly string[];
  workspace?: string;
}) {
  const adminNote = admins.length
    ? `${admins.length} 位管理员可以切换会话，并接收${adminWorkspaces.length ? `${adminWorkspaces.length} 个 Workspace` : '所有 Workspace'}中会话的通知。`
    : '尚未设置管理员：没有人可以切换会话或接收他人会话的通知。';
  if (summary.level === 'restricted') {
    return (
      <div className="wcb-banner" data-tone="success" role="status">
        <span className="wcb-banner-icon"><IconCheckCircleOutlineRegular size={18} /></span>
        <div>
          <div className="wcb-banner-title">已限定企微用户与会话</div>
          <div className="wcb-banner-body">
            只有勾选的企微用户、在勾选的会话里，才能给机器人发消息。每个用户/群只会到达自己的专属会话{workspace ? `（Workspace：${workspace}）` : ''}。{adminNote}
          </div>
        </div>
      </div>
    );
  }
  const open = summary.level === 'open';
  return (
    <div className="wcb-banner" data-tone={open ? 'danger' : 'warning'} role="alert">
      <span className="wcb-banner-icon">{open ? <IconWarningTriangleOutlineRegular size={18} /> : <IconShieldOutlineRegular size={18} />}</span>
      <div>
        <div className="wcb-banner-title">
          {open ? '安全风险：尚未设置任何访问范围' : '部分范围未限制'}
        </div>
        <div className="wcb-banner-body">
          {open
            ? `任何能给机器人发消息的企业微信用户都会得到一个专属 DSH 会话，可以在 Workspace（${workspace || '插件目录'}）里执行命令、修改文件。`
            : '以下范围留空，表示对该范围全部允许：'}
          <div className="wcb-chips">
            {summary.unrestricted.map(dimension => <Tag key={dimension} tone={open ? 'danger' : 'warning'}>{DIMENSION_LABEL[dimension]}</Tag>)}
          </div>
          <ol>
            <li>在「访问范围」中只勾选你自己的 userid，以及你与机器人的单聊。</li>
            <li>给默认 Workspace 选一个可以放心让机器人改动的目录。</li>
            <li>群聊里的通知对所有群成员可见，请谨慎授权群聊。</li>
          </ol>
          <div className="wcb-banner-foot">{adminNote}</div>
        </div>
      </div>
    </div>
  );
}
