/** One allowlist panel: observed IDs plus manual additions, as checkboxes. */
import { useState, type ReactNode } from 'react';
import { Button, IconPlusOutlineRegular, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ObservedIdentity } from '../../shared/protocol.ts';
import { identityRows, toggle } from '../model.ts';
import { CheckRow, Empty, ScopeTag } from './ui.tsx';

export function IdListPanel({ kind, title, hint, icon, observed, selected, disabled, onChange, empty, meta, placeholder, verb = '允许' }: {
  kind: 'users' | 'chats';
  title: string;
  hint: string;
  icon: ReactNode;
  observed: readonly ObservedIdentity[];
  selected: readonly string[];
  disabled: boolean;
  onChange(next: string[]): void;
  empty: ReactNode;
  /** Right-hand annotation for one row; `undefined` for manually added IDs. */
  meta?(entry: ObservedIdentity | undefined, id: string): ReactNode;
  placeholder: string;
  /** Accessible-name prefix of each row checkbox, so two panels stay distinguishable. */
  verb?: string;
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
          <div style={{ padding: 10 }}><Empty>{empty}</Empty></div>
        ) : (
          <div className="wcb-panel-scroll">
            {rows.map(({ id, observed: entry }) => (
              <CheckRow
                key={id}
                checked={selected.includes(id)}
                label={`${verb}${kind === 'users' ? '用户' : '会话'} ${id}`}
                disabled={disabled}
                onToggle={on => onChange(toggle(selected, id, on))}
                meta={meta?.(entry, id) ?? (entry ? undefined : <Tag tone="quiet">手动添加</Tag>)}
              >
                <span className="wcb-row-title wcb-mono" style={{ fontSize: 13 }} title={id}>{id}</span>
                <span className="wcb-row-sub">{entry ? '' : '尚未收到过消息'}</span>
              </CheckRow>
            ))}
          </div>
        )}
        <div className="wcb-add">
          <Input
            className="wcb-grow"
            value={manual}
            placeholder={placeholder}
            aria-label={placeholder}
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
