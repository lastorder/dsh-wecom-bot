import { IconUserOutlineRegular, IconUsersOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ObservedIdentities, ObservedIdentity, RejectionReason } from '../../shared/protocol.ts';
import { relativeTime } from '../model.ts';
import { IdListPanel } from './IdListPanel.tsx';
import { Card } from './ui.tsx';

const REASON: Record<RejectionReason, string> = {
  user: '用户不在白名单',
  chat: '会话不在白名单',
  'user+chat': '用户和会话都不在白名单',
};

/** Step 4: WeCom senders and conversations allowed to talk to the Bot at all. */
export function IdentityPicker({ observed, chatIds, userIds, disabled, connected, onChange }: {
  observed: ObservedIdentities | undefined;
  chatIds: readonly string[];
  userIds: readonly string[];
  disabled: boolean;
  connected: boolean;
  onChange(patch: { chatIds?: string[]; allowedUserIds?: string[] }): void;
}) {
  const rejected = (observed?.users ?? []).filter(user => user.decision === 'rejected').length;
  const empty = (
    <>
      {connected ? '还没有收到消息。' : '机器人尚未在线。'}
      <ol>
        <li>填写 Bot ID 与 Secret 并保存；</li>
        <li>在企业微信里给机器人发一条消息（群聊里请 @机器人）；</li>
        <li>几秒后 ID 会自动出现在这里。</li>
      </ol>
    </>
  );
  return (
    <Card
      step={4}
      title="访问范围"
      description="这里只列出最近 24 小时内真正给机器人发过消息的 ID，包括被白名单拒绝的。勾选即加入白名单；某一列不勾选表示该项不限制。通过校验的用户会各自获得一个专属会话。"
      aside={rejected ? <Tag tone="danger">{rejected} 个用户被拒绝</Tag> : undefined}
    >
      <div className="wcb-columns">
        <IdListPanel
          kind="users"
          title="允许的用户"
          hint="企业微信 userid"
          icon={<IconUserOutlineRegular size={16} />}
          observed={observed?.users ?? []}
          selected={userIds}
          disabled={disabled}
          empty={empty}
          placeholder="手动添加 userid"
          onChange={next => onChange({ allowedUserIds: next })}
          meta={entry => (entry ? <DecisionTag entry={entry} /> : undefined)}
        />
        <IdListPanel
          kind="chats"
          title="允许的会话"
          hint="单聊 = 对方 userid；群聊 = chatid"
          icon={<IconUsersOutlineRegular size={16} />}
          observed={observed?.chats ?? []}
          selected={chatIds}
          disabled={disabled}
          empty={empty}
          placeholder="手动添加 chatid / userid"
          onChange={next => onChange({ chatIds: next })}
          meta={entry => (entry ? <ChatMeta entry={entry} /> : undefined)}
        />
      </div>
      <div className="wcb-list-foot">
        <span>ID 列表保存在内存中，DSH 重启后需要重新收到消息才会出现（绑定关系不受影响）。</span>
        <span>在企业微信里发送 <span className="wcb-code">/whoami</span> 也可查看自己的 ID。</span>
      </div>
    </Card>
  );
}

function ChatMeta({ entry }: { entry: ObservedIdentity }) {
  const parts = [relativeTime(entry.lastSeenAt), `${entry.messages} 条消息`];
  if (entry.chatType === 'group' && entry.via) parts.push(`最近发言 ${entry.via}`);
  return (
    <span className="wcb-row-meta-inner" title={entry.reason ? REASON[entry.reason] : undefined}>
      {entry.decision === 'rejected' ? <Tag tone="danger">上次被拒绝</Tag> : <Tag tone="success">上次已接受</Tag>}
      <span className="wcb-muted">{parts.join(' · ')}</span>
    </span>
  );
}

function DecisionTag({ entry }: { entry: ObservedIdentity }) {
  const parts = [relativeTime(entry.lastSeenAt), `${entry.messages} 条消息`];
  if (entry.via && entry.via !== entry.id) parts.push(`来自群 ${entry.via}`);
  return (
    <span className="wcb-row-meta-inner" title={entry.reason ? REASON[entry.reason] : undefined}>
      {entry.decision === 'rejected' ? <Tag tone="danger">上次被拒绝</Tag> : <Tag tone="success">上次已接受</Tag>}
      <span className="wcb-muted">{parts.join(' · ')}</span>
    </span>
  );
}
