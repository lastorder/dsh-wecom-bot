import { useState, type ReactNode } from 'react';
import {
  Button, IconPlusOutlineRegular, IconUserOutlineRegular, IconUsersOutlineRegular, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { ObservedIdentities, ObservedIdentity, RejectionReason } from '../../shared/protocol.ts';
import { identityRows, relativeTime, toggle } from '../model.ts';
import { Card, CheckRow, Empty, ScopeTag } from './ui.tsx';

const REASON: Record<RejectionReason, string> = {
  user: '用户不在白名单',
  chat: '会话不在白名单',
  'user+chat': '用户和会话都不在白名单',
};

/** Step 3: WeCom senders and conversations that actually messaged the Bot. */
export function IdentityPicker({ observed, chatIds, userIds, disabled, connected, onChange }: {
  observed: ObservedIdentities | undefined;
  chatIds: readonly string[];
  userIds: readonly string[];
  disabled: boolean;
  connected: boolean;
  onChange(patch: { chatIds?: string[]; allowedUserIds?: string[] }): void;
}) {
  const rejected = (observed?.users ?? []).filter(user => user.decision === 'rejected').length;
  return (
    <Card
      step={3}
      title="企业微信来源"
      description="这里只列出最近 24 小时内真正给机器人发过消息的 ID，包括被白名单拒绝的。勾选即加入白名单；某一列不勾选表示该项不限制。"
      aside={rejected ? <Tag tone="danger">{rejected} 个用户被拒绝</Tag> : undefined}
    >
      <div className="wcb-columns">
        <IdentityPanel
          kind="users"
          title="允许的用户"
          hint="企业微信 userid"
          icon={<IconUserOutlineRegular size={16} />}
          observed={observed?.users ?? []}
          selected={userIds}
          disabled={disabled}
          connected={connected}
          onChange={next => onChange({ allowedUserIds: next })}
        />
        <IdentityPanel
          kind="chats"
          title="允许的会话"
          hint="单聊 = 对方 userid；群聊 = chatid"
          icon={<IconUsersOutlineRegular size={16} />}
          observed={observed?.chats ?? []}
          selected={chatIds}
          disabled={disabled}
          connected={connected}
          onChange={next => onChange({ chatIds: next })}
        />
      </div>
      <div className="wcb-list-foot">
        <span>ID 列表保存在内存中，DSH 重启后需要重新收到消息才会出现。</span>
        <span>在企业微信里发送 <span className="wcb-code">/whoami</span> 也可查看自己的 ID（仅限已允许的用户）。</span>
      </div>
    </Card>
  );
}

function IdentityPanel({ kind, title, hint, icon, observed, selected, disabled, connected, onChange }: {
  kind: 'users' | 'chats';
  title: string;
  hint: string;
  icon: ReactNode;
  observed: readonly ObservedIdentity[];
  selected: readonly string[];
  disabled: boolean;
  connected: boolean;
  onChange(next: string[]): void;
}) {
  const [manual, setManual] = useState('');
  const rows = identityRows(observed, selected);
  const add = () => {
    const id = manual.trim();
    if (!id) return;
    onChange(toggle(selected, id, true));
    setManual('');
  };
  return (
    <div>
      <div className="wcb-subhead">
        {icon}
        <span className="wcb-subhead-title">{title}</span>
        <span className="wcb-subhead-hint">{hint}</span>
        <span className="wcb-card-aside"><ScopeTag count={selected.length} /></span>
      </div>
      <div className="wcb-panel">
        {rows.length === 0 ? (
          <div style={{ padding: 10 }}>
            <Empty>
              {connected ? '还没有收到消息。' : '机器人尚未在线。'}
              <ol>
                <li>填写 Bot ID 与 Secret 并保存；</li>
                <li>在企业微信里给机器人发一条消息（群聊里请 @机器人）；</li>
                <li>几秒后 ID 会自动出现在这里。</li>
              </ol>
            </Empty>
          </div>
        ) : (
          <div className="wcb-panel-scroll">
            {rows.map(({ id, observed: entry }) => (
              <CheckRow
                key={id}
                checked={selected.includes(id)}
                label={`允许${kind === 'users' ? '用户' : '会话'} ${id}`}
                disabled={disabled}
                onToggle={on => onChange(toggle(selected, id, on))}
                meta={entry ? <DecisionTag entry={entry} /> : <Tag tone="quiet">手动添加</Tag>}
              >
                <span className="wcb-row-title wcb-mono" style={{ fontSize: 13 }} title={id}>{id}</span>
                <span className="wcb-row-sub">
                  {entry ? describe(kind, entry) : '24 小时内未收到消息'}
                </span>
              </CheckRow>
            ))}
          </div>
        )}
        <div className="wcb-add">
          <Input
            className="wcb-grow"
            value={manual}
            placeholder={kind === 'users' ? '手动添加 userid' : '手动添加 chatid / userid'}
            aria-label={kind === 'users' ? '手动添加 userid' : '手动添加会话 ID'}
            disabled={disabled}
            onChange={event => setManual(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
          />
          <Button variant="outline" size="sm" icon={<IconPlusOutlineRegular />} disabled={disabled || !manual.trim()} onClick={add}>
            添加
          </Button>
        </div>
      </div>
    </div>
  );
}

function describe(kind: 'users' | 'chats', entry: ObservedIdentity): string {
  const parts = [`${relativeTime(entry.lastSeenAt)}`, `${entry.messages} 条消息`];
  if (kind === 'chats') parts.unshift(entry.chatType === 'group' ? '群聊' : '单聊');
  if (kind === 'chats' && entry.chatType === 'group' && entry.via) parts.push(`最近发言 ${entry.via}`);
  if (kind === 'users' && entry.via && entry.via !== entry.id) parts.push(`来自群 ${entry.via}`);
  return parts.join(' · ');
}

function DecisionTag({ entry }: { entry: ObservedIdentity }) {
  return entry.decision === 'rejected'
    ? <span title={entry.reason ? REASON[entry.reason] : undefined}><Tag tone="danger">上次被拒绝</Tag></span>
    : <Tag tone="success">上次已接受</Tag>;
}
