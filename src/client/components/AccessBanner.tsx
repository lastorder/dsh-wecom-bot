import { IconCheckCircleOutlineRegular, IconShieldOutlineRegular, IconWarningTriangleOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { AccessDimension, AccessSummary } from '../model.ts';

const DIMENSION_LABEL: Record<AccessDimension, string> = {
  sessions: 'DSH 会话：全部未归档会话',
  chats: '企微会话：所有单聊与群聊',
  users: '企微用户：任何人',
};

/** Prominent explanation of what an empty allowlist exposes. */
export function AccessBanner({ summary }: { summary: AccessSummary }) {
  if (summary.level === 'restricted') {
    return (
      <div className="wcb-banner" data-tone="success" role="status">
        <span className="wcb-banner-icon"><IconCheckCircleOutlineRegular size={18} /></span>
        <div>
          <div className="wcb-banner-title">已启用三重白名单</div>
          <div className="wcb-banner-body">只有勾选的企微用户、在勾选的会话里，才能操作勾选的 DSH 会话。被拒绝的消息不会得到任何回复，但会出现在下方列表中供你审核。</div>
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
          {open ? '安全风险：尚未设置任何白名单' : '部分范围未限制'}
        </div>
        <div className="wcb-banner-body">
          {open
            ? '只要能给机器人发消息，任何企业微信用户都可以读取本轮回复、向你的 DSH 会话发送指令（可能触发命令执行和文件修改）。'
            : '以下范围留空，表示对该范围全部允许：'}
          <div className="wcb-chips">
            {summary.unrestricted.map(dimension => <Tag key={dimension} tone={open ? 'danger' : 'warning'}>{DIMENSION_LABEL[dimension]}</Tag>)}
          </div>
          <ol>
            <li>在下方「企业微信来源」中只勾选你自己的 userid，以及你与机器人的单聊。</li>
            <li>在「DSH 会话」中只勾选需要远程操作的会话。</li>
            <li>群聊里的通知对所有群成员可见，请谨慎授权群聊。</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
