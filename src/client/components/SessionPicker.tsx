import { useMemo, useState } from 'react';
import {
  Button, IconChevronRightOutlineRegular, IconFolderCloseRegular, IconPinFillRegular,
  IconRefreshOutlineRegular, IconSearchOutlineRegular, Input, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { CatalogGroup, HiddenSelection, SessionCatalogView } from '../../shared/protocol.ts';
import { displayPath, filterGroups, relativeTime, setAll, toggle } from '../model.ts';
import { Card, CheckRow, Empty, ScopeTag } from './ui.tsx';

const HIDDEN_REASON: Record<HiddenSelection['reason'], string> = {
  archived: '已归档',
  subagent: '子代理会话',
  blank: '空会话',
  missing: '已删除或不可见',
};

const UNTITLED = '未命名会话';

/** Step 2: which DSH Sessions WeCom may operate, grouped by Workspace like the sidebar. */
export function SessionPicker({ catalog, error, loading, refreshing, selected, disabled, onChange, onRefresh }: {
  catalog: SessionCatalogView | null | undefined;
  error?: string;
  loading: boolean;
  refreshing: boolean;
  selected: readonly string[];
  disabled: boolean;
  onChange(next: string[]): void;
  onRefresh(): void;
}) {
  const [query, setQuery] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const groups = useMemo(
    () => filterGroups(catalog?.groups ?? [], query, onlySelected ? selectedSet : undefined),
    [catalog, query, onlySelected, selectedSet],
  );
  const shown = groups.reduce((sum, group) => sum + group.sessions.length, 0);
  const searching = Boolean(query.trim()) || onlySelected;

  const isOpen = (group: CatalogGroup, index: number) =>
    searching || (open[group.key] ?? (index < 2 || group.sessions.some(session => selectedSet.has(session.sessionId))));

  return (
    <Card
      step={2}
      title="DSH 会话范围"
      description="勾选允许从企业微信查看与操作的会话；不勾选表示所有未归档会话都可操作。已归档、子代理和空会话不会显示。"
      aside={<ScopeTag count={selected.length} />}
    >
      <div className="wcb-toolbar">
        <Input
          className="wcb-search"
          icon={<IconSearchOutlineRegular />}
          value={query}
          placeholder="搜索会话名称、ID 或工作区"
          aria-label="搜索会话"
          onChange={event => setQuery(event.target.value)}
        />
        <Button variant={onlySelected ? 'toolbar' : 'ghost'} size="sm" aria-pressed={onlySelected} onClick={() => setOnlySelected(value => !value)}>
          仅看已选
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled || !selected.length} onClick={() => onChange([])}>
          清空选择
        </Button>
        <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} disabled={refreshing} onClick={onRefresh} aria-label="刷新会话列表">
          {refreshing ? '刷新中' : '刷新'}
        </Button>
      </div>

      {!catalog ? (
        <Empty>{error ?? (loading ? '正在读取 DSH 会话列表…' : '会话列表不可用。')}</Empty>
      ) : groups.length === 0 ? (
        <Empty>{searching ? '没有匹配的会话。' : '还没有可选择的会话。在 DSH 中开始一个对话后，它会出现在这里。'}</Empty>
      ) : (
        <div className="wcb-scroll">
          {groups.map((group, index) => (
            <SessionGroup
              key={group.key}
              group={group}
              open={isOpen(group, index)}
              selected={selectedSet}
              disabled={disabled}
              onToggleOpen={() => setOpen(state => ({ ...state, [group.key]: !isOpen(group, index) }))}
              onSelectGroup={on => onChange(setAll(selected, group.sessions.map(session => session.sessionId), on))}
              onSelect={(id, on) => onChange(toggle(selected, id, on))}
            />
          ))}
        </div>
      )}

      {catalog && catalog.hiddenSelections.length > 0 && (
        <div className="wcb-hidden-list">
          <div className="wcb-hidden-head">
            已勾选但当前不可操作（{catalog.hiddenSelections.length}）
            <span style={{ flex: 1 }} />
            <Button variant="ghost" size="sm" disabled={disabled}
              onClick={() => onChange(setAll(selected, catalog.hiddenSelections.map(item => item.sessionId), false))}>
              全部移除
            </Button>
          </div>
          {catalog.hiddenSelections.map(item => (
            <CheckRow
              key={item.sessionId}
              checked={selectedSet.has(item.sessionId)}
              label={`取消勾选 ${item.title ?? item.sessionId}`}
              disabled={disabled}
              onToggle={on => onChange(toggle(selected, item.sessionId, on))}
              meta={<Tag tone="warning">{HIDDEN_REASON[item.reason]}</Tag>}
            >
              <span className="wcb-row-title" data-muted={item.title ? undefined : ''}>{item.title ?? UNTITLED}</span>
              <span className="wcb-row-sub wcb-mono">{item.sessionId}</span>
            </CheckRow>
          ))}
        </div>
      )}

      {catalog && (
        <div className="wcb-list-foot">
          <span>显示 {shown} / {catalog.total} 个会话</span>
          {catalog.archived > 0 && <span>已隐藏 {catalog.archived} 个已归档会话</span>}
          <span>更新于 {relativeTime(catalog.generatedAt)}</span>
        </div>
      )}
    </Card>
  );
}

function SessionGroup({ group, open, selected, disabled, onToggleOpen, onSelectGroup, onSelect }: {
  group: CatalogGroup;
  open: boolean;
  selected: ReadonlySet<string>;
  disabled: boolean;
  onToggleOpen(): void;
  onSelectGroup(on: boolean): void;
  onSelect(id: string, on: boolean): void;
}) {
  const count = group.sessions.filter(session => selected.has(session.sessionId)).length;
  const all = count === group.sessions.length;
  return (
    <div className="wcb-group" data-open={open ? '' : undefined}>
      <div className="wcb-group-head" role="button" tabIndex={0} aria-expanded={open}
        onClick={onToggleOpen}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          onToggleOpen();
        }}>
        <span className="wcb-chevron"><IconChevronRightOutlineRegular size={14} /></span>
        <input
          type="checkbox"
          className="wcb-check"
          checked={all}
          disabled={disabled}
          aria-label={`选择工作区 ${group.title} 的全部会话`}
          ref={element => { if (element) element.indeterminate = count > 0 && !all; }}
          onClick={event => event.stopPropagation()}
          onChange={event => onSelectGroup(event.target.checked)}
        />
        <span className="wcb-group-icon"><IconFolderCloseRegular size={16} /></span>
        <span className="wcb-group-title" title={group.title}>{group.title}</span>
        <span className="wcb-group-path" title={group.path}>{displayPath(group.path)}</span>
        <span className="wcb-group-count">{count ? `${count}/` : ''}{group.sessions.length}</span>
      </div>
      {open && group.sessions.map(session => (
        <CheckRow
          key={session.sessionId}
          checked={selected.has(session.sessionId)}
          label={`选择会话 ${session.title ?? session.sessionId}`}
          disabled={disabled}
          onToggle={on => onSelect(session.sessionId, on)}
          meta={(
            <>
              {session.pinned && <span className="wcb-pin" title="已置顶"><IconPinFillRegular size={12} /></span>}
              {session.running && <span className="wcb-running"><StateDot state="ongoing" size={12} />运行中</span>}
              <span>{relativeTime(session.updatedAt)}</span>
            </>
          )}
        >
          <span className="wcb-row-title" data-muted={session.title ? undefined : ''} title={session.title ?? UNTITLED}>{session.title ?? UNTITLED}</span>
          <span className="wcb-row-sub wcb-mono wcb-ellipsis" title={session.sessionId}>{session.sessionId}</span>
        </CheckRow>
      ))}
    </div>
  );
}
