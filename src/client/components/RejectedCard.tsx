import { useState } from 'react';
import {
  IconCheckCircleOutlineRegular, IconUserOutlineRegular, IconUsersOutlineRegular, Button, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { postRouting } from '../api.ts';
import type { BridgeStateView, GroupView, RejectedSenderView } from '../../shared/protocol.ts';
import { BINDING_KIND_LABEL, addMember, relativeTime } from '../model.ts';
import { Card, Empty, Select } from './ui.tsx';

/**
 * Step 3: senders the Bot refused because they belong to no group.
 *
 * The list is Host memory only (nothing is written until they are authorized),
 * so it resets on restart — authorizing one is what makes it disappear, and
 * that is exactly the point of this card. Each row shows the latest refused
 * message so the operator can tell who is knocking.
 */
export function RejectedCard({ state, disabled, onChanged }: {
  state: BridgeStateView | undefined;
  disabled: boolean;
  onChanged(): void;
}) {
  const rows = state?.rejected ?? [];
  const groups = state?.routing?.groups ?? [];
  return (
    <Card
      step={3}
      title="未授权用户"
      description="给机器人发过消息、但不在任何分组里的人。选择分组并确认即完成授权；备注会代替 userid 显示。列表只保留在内存中，重启 DSH 后清空。"
      aside={<Tag tone={rows.length ? 'warning' : 'quiet'}>{rows.length} 个待处理</Tag>}
    >
      {rows.length === 0 ? (
        <Empty>
          暂时没有被拒绝的用户。任何人给机器人发消息后，如果它不在任何分组里，就会出现在这里。
        </Empty>
      ) : (
        <div className="wcb-scroll">
          {rows.map(row => (
            <RejectedRow key={row.key} row={row} groups={groups} disabled={disabled} onChanged={onChanged} />
          ))}
        </div>
      )}
    </Card>
  );
}

function RejectedRow({ row, groups, disabled, onChanged }: {
  row: RejectedSenderView;
  groups: readonly Pick<GroupView, 'id' | 'name'>[];
  disabled: boolean;
  onChanged(): void;
}) {
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState(groups.find(group => group.id === 'default')?.id ?? groups[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function authorize(): Promise<void> {
    if (!groupId) { setError('还没有可用的分组。'); return; }
    setBusy(true);
    setError(undefined);
    try {
      await postRouting([addMember(groupId, row.kind, row.id, label.trim())]);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wcb-member">
      <div className="wcb-member-head">
        <span className="wcb-binding-icon">
          {row.kind === 'group' ? <IconUsersOutlineRegular size={15} /> : <IconUserOutlineRegular size={15} />}
        </span>
        <Tag tone={row.kind === 'group' ? 'warning' : 'info'}>{BINDING_KIND_LABEL[row.kind]}</Tag>
        <span className="wcb-row-title" title={row.id}>{row.displayName}</span>
        <span style={{ flex: 1 }} />
        <span className="wcb-row-sub">{row.messages} 次 · {relativeTime(row.lastSeenAt)}</span>
        <Button variant="outline" size="sm" disabled={disabled || !groups.length} onClick={() => setOpen(value => !value)}>
          {open ? '收起' : '加入分组'}
        </Button>
      </div>

      {row.text && <div className="wcb-rejected-text" title={row.text}>{row.text}</div>}

      {open && (
        <div className="wcb-member-edit">
          <label className="wcb-binding-field">
            <span className="wcb-binding-label">分组</span>
            <Select
              value={groupId}
              disabled={disabled || busy}
              aria-label={`${row.id} 的分组`}
              onChange={event => setGroupId(event.target.value)}
            >
              {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </Select>
          </label>
          <label className="wcb-binding-field">
            <span className="wcb-binding-label">备注（优先显示）</span>
            <Input
              value={label}
              placeholder={row.id}
              disabled={disabled || busy}
              aria-label={`${row.id} 的备注`}
              onChange={event => setLabel(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void authorize(); } }}
            />
          </label>
          <div className="wcb-member-actions">
            <Button variant="primary" size="sm" icon={<IconCheckCircleOutlineRegular />} disabled={disabled || busy} onClick={() => { void authorize(); }}>
              {busy ? '授权中…' : '确认授权'}
            </Button>
          </div>
          {error && <div className="wcb-field-error" role="alert">{error}</div>}
        </div>
      )}
    </div>
  );
}
