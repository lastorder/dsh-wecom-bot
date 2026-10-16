import { useMemo, useState } from 'react';
import {
  Button, IconChevronRightOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
  IconSearchOutlineRegular, IconTrashOutlineRegular, IconUserOutlineRegular, IconUsersOutlineRegular,
  Input, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { postBindings } from '../api.ts';
import type { BindingOp, BindingView, BridgeStateView, CatalogGroup, ModelCatalogView, WorkspaceOption } from '../../shared/protocol.ts';
import {
  BINDING_KIND_LABEL, SESSION_STATE_LABEL, bindingGroups, choiceLabel, displayPath, dshDefaultLabel,
  effortsFor, modelKey, modelLabel, parseModelKey, relativeTime, sessionOptions, setBindingModel,
  setBindingSession, setBindingWorkspace,
} from '../model.ts';
import { Card, Empty, Select } from './ui.tsx';

/**
 * Step 3: the routing table. One row per WeCom private chat or group, grouped
 * by the Workspace its Session lives in. Edits apply immediately (the Host
 * owns this state, not the Config form), so the row never waits for «保存».
 */
export function BindingsCard({ state, error, disabled, refreshing, onRefresh, onChanged }: {
  state: BridgeStateView | undefined;
  error?: string;
  disabled: boolean;
  refreshing: boolean;
  onRefresh(): void;
  onChanged(): void;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [kind, setKind] = useState<'user' | 'group'>('user');
  const [newId, setNewId] = useState('');

  const view = state?.bindings;
  const groups = useMemo(() => bindingGroups(view, query), [view, query]);
  const sessionGroups = state?.sessions?.groups;

  async function apply(key: string, ops: BindingOp[], label: string): Promise<void> {
    setBusy(key);
    setFeedback(undefined);
    try {
      await postBindings(ops);
      setFeedback({ tone: 'ok', text: `${label}已生效。` });
      onChanged();
    } catch (cause) {
      setFeedback({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy('');
    }
  }

  return (
    <Card
      step={3}
      title="会话绑定"
      description="每个企业微信用户（单聊）或群聊都有自己的绑定：指定 Workspace、DSH 会话与模型。改动即时生效，不需要点「保存配置」。"
      aside={<Tag tone={view ? 'info' : 'quiet'}>共 {view?.total ?? 0} 个绑定</Tag>}
    >
      <div className="wcb-toolbar">
        <Input
          className="wcb-search"
          icon={<IconSearchOutlineRegular />}
          value={query}
          placeholder="搜索 userid、chatid、会话名称或 Workspace"
          aria-label="搜索绑定"
          onChange={event => setQuery(event.target.value)}
        />
        <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} disabled={refreshing} onClick={onRefresh} aria-label="刷新绑定">
          {refreshing ? '刷新中' : '刷新'}
        </Button>
      </div>

      {feedback && (
        <div className="wcb-banner" data-tone={feedback.tone === 'ok' ? 'success' : 'danger'} role="status">
          <div><div className="wcb-banner-body">{feedback.text}</div></div>
        </div>
      )}

      {!view ? (
        <Empty>{error ?? state?.bindingsError ?? '正在读取绑定信息…'}</Empty>
      ) : groups.length === 0 ? (
        <Empty>
          {view.total === 0
            ? '还没有任何绑定。企业微信里的用户或群第一次给机器人发消息时会自动出现在这里。'
            : '没有匹配的绑定。'}
        </Empty>
      ) : (
        <div className="wcb-scroll">
          {groups.map(group => (
            <BindingGroupView
              key={group.key}
              title={group.title}
              path={group.path}
              rows={group.rows}
              state={state}
              sessionGroups={sessionGroups}
              disabled={disabled}
              busy={busy}
              onApply={apply}
            />
          ))}
        </div>
      )}

      <div className="wcb-add">
        <Select value={kind} disabled={disabled} aria-label="新增绑定的类型" onChange={event => setKind(event.target.value as 'user' | 'group')}>
          <option value="user">个人（userid）</option>
          <option value="group">群聊（chatid）</option>
        </Select>
        <Input
          className="wcb-grow"
          value={newId}
          placeholder={kind === 'user' ? 'userid' : 'chatid'}
          aria-label="新增绑定的 ID"
          disabled={disabled}
          onChange={event => setNewId(event.target.value)}
        />
        <Button
          variant="outline" size="sm" icon={<IconPlusOutlineRegular />}
          disabled={disabled || !newId.trim()}
          onClick={() => {
            const id = newId.trim();
            if (!id) return;
            void apply('new', [{ op: 'create', kind, id }], '新增绑定').then(() => setNewId(''));
          }}
        >
          新增绑定
        </Button>
      </div>

      <div className="wcb-list-foot">
        <span>绑定保存在 <span className="wcb-code">DSH home/wecom-bot/bindings.json</span>，重启后依然有效。</span>
        <span>删除绑定不会删除 DSH 里已有的会话。</span>
      </div>
    </Card>
  );
}

function BindingGroupView({ title, path, rows, state, sessionGroups, disabled, busy, onApply }: {
  title: string;
  path: string;
  rows: readonly BindingView[];
  state: BridgeStateView | undefined;
  sessionGroups: readonly CatalogGroup[] | undefined;
  disabled: boolean;
  busy: string;
  onApply(key: string, ops: BindingOp[], label: string): Promise<void>;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="wcb-group" data-open={open ? '' : undefined}>
      <div className="wcb-group-head" role="button" tabIndex={0} aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          setOpen(value => !value);
        }}>
        <span className="wcb-chevron"><IconChevronRightOutlineRegular size={14} /></span>
        <span className="wcb-group-title" title={title}>{title}</span>
        <span className="wcb-group-path" title={path}>{displayPath(path)}</span>
        <span className="wcb-group-count">{rows.length}</span>
      </div>
      {open && rows.map(binding => (
        <BindingRow
          key={binding.key}
          binding={binding}
          state={state}
          sessionGroups={sessionGroups}
          disabled={disabled || busy === binding.key}
          onApply={onApply}
        />
      ))}
    </div>
  );
}

function BindingRow({ binding, state, sessionGroups, disabled, onApply }: {
  binding: BindingView;
  state: BridgeStateView | undefined;
  sessionGroups: readonly CatalogGroup[] | undefined;
  disabled: boolean;
  onApply(key: string, ops: BindingOp[], label: string): Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const catalog: ModelCatalogView | null | undefined = state?.models;
  const workspaces: readonly WorkspaceOption[] = state?.workspaces ?? [];
  const options = sessionOptions(binding, sessionGroups);
  const modelValue = modelKey(binding.provider, binding.model);
  const efforts = effortsFor(catalog, binding.provider || binding.effectiveProvider, binding.model || binding.effectiveModel);
  const pluginDefault = state?.defaults;
  const defaultLabel = pluginDefault?.provider && pluginDefault?.model
    ? modelLabel(catalog, { provider: pluginDefault.provider, model: pluginDefault.model })
    : dshDefaultLabel(catalog);
  const chosenModel = binding.provider && binding.model ? { provider: binding.provider, model: binding.model } : undefined;

  return (
    <div className="wcb-binding">
      <div className="wcb-binding-head">
        <span className="wcb-binding-icon">
          {binding.kind === 'group' ? <IconUsersOutlineRegular size={15} /> : <IconUserOutlineRegular size={15} />}
        </span>
        <Tag tone={binding.kind === 'group' ? 'warning' : 'info'}>{BINDING_KIND_LABEL[binding.kind]}</Tag>
        <span className="wcb-row-title wcb-mono" title={binding.id}>{binding.id}</span>
        {binding.admin && <Tag tone="success">管理员</Tag>}
        <span style={{ flex: 1 }} />
        <span className="wcb-row-sub">
          {binding.messages ? `${binding.messages} 条消息 · ${relativeTime(binding.lastSeenAt)}` : '尚未收到消息'}
        </span>
      </div>

      <div className="wcb-binding-controls">
        <label className="wcb-binding-field">
          <span className="wcb-binding-label">Workspace</span>
          <Select
            value={binding.workspace}
            disabled={disabled}
            aria-label={`${binding.id} 的 Workspace`}
            onChange={event => {
              const workspace = event.target.value;
              void onApply(binding.key, [
                setBindingWorkspace(binding.key, workspace),
                ...(binding.sessionId ? [setBindingSession(binding.key, '')] : []),
              ], 'Workspace');
            }}
          >
            <option value="">插件默认{pluginDefault?.workspaceTitle ? `（${pluginDefault.workspaceTitle}）` : ''}</option>
            {workspaces.map(workspace => (
              <option key={workspace.path} value={workspace.path}>
                {workspace.title} — {displayPath(workspace.path)}
              </option>
            ))}
            {binding.workspace && !workspaces.some(workspace => workspace.path === binding.workspace) && (
              <option value={binding.workspace}>{binding.workspace}（未注册）</option>
            )}
          </Select>
        </label>

        <label className="wcb-binding-field">
          <span className="wcb-binding-label">DSH 会话</span>
          <Select
            value={binding.sessionId}
            disabled={disabled}
            aria-label={`${binding.id} 的会话`}
            onChange={event => { void onApply(binding.key, [setBindingSession(binding.key, event.target.value)], '会话'); }}
          >
            <option value="">自动（下一条消息时创建）</option>
            {options.map(option => (
              <option key={option.sessionId} value={option.sessionId}>
                {option.title ?? '未命名会话'} — {option.sessionId.slice(-8)}{option.stale ? '（当前不可见）' : ''}
              </option>
            ))}
          </Select>
        </label>

        <label className="wcb-binding-field">
          <span className="wcb-binding-label">模型</span>
          <Select
            value={modelValue}
            disabled={disabled || !catalog}
            aria-label={`${binding.id} 的模型`}
            onChange={event => {
              const next = parseModelKey(event.target.value);
              void onApply(binding.key, [setBindingModel(binding.key, next.provider, next.model, '')], '模型');
            }}
          >
            <option value="">跟随默认（{defaultLabel}）</option>
            {(catalog?.choices ?? []).map(choice => (
              <option key={modelKey(choice.provider, choice.model)} value={modelKey(choice.provider, choice.model)}>
                {choice.providerName} / {choiceLabel(choice)}
              </option>
            ))}
          </Select>
        </label>

        {efforts.length > 0 && (
          <label className="wcb-binding-field wcb-binding-field-narrow">
            <span className="wcb-binding-label">思考强度</span>
            <Select
              value={binding.reasoningEffort ?? ''}
              disabled={disabled}
              aria-label={`${binding.id} 的思考强度`}
              onChange={event => {
                const selection = chosenModel ?? (pluginDefault?.provider && pluginDefault?.model
                  ? { provider: pluginDefault.provider, model: pluginDefault.model }
                  : undefined);
                if (!selection) return;
                void onApply(binding.key, [setBindingModel(binding.key, selection.provider, selection.model, event.target.value)], '思考强度');
              }}
            >
              <option value="">默认</option>
              {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
            </Select>
          </label>
        )}
      </div>

      <div className="wcb-binding-foot">
        <span className="wcb-row-sub">
          {binding.sessionId
            ? <><StateDot state={binding.sessionRunning ? 'ongoing' : 'done'} size={10} /> {binding.sessionTitle ?? '未命名会话'}
              <span className="wcb-mono"> {binding.sessionId}</span>
              <Tag tone={binding.sessionState === 'bound' || binding.sessionState === 'blank' ? 'quiet' : 'warning'}>
                {SESSION_STATE_LABEL[binding.sessionState]}
              </Tag></>
            : '还没有专属会话，收到消息时会自动创建。'}
        </span>
        <span className="wcb-row-meta">
          {binding.sessionModel && <Tag tone="quiet">实际使用 {modelLabel(catalog, binding.sessionModel)}</Tag>}
          {binding.workspaceError && <Tag tone="warning" >{binding.workspaceError}</Tag>}
        </span>
        <span style={{ flex: 1 }} />
        {binding.sessionId && (
          <Button
            variant="ghost" size="sm" disabled={disabled}
            onClick={() => { void onApply(binding.key, [setBindingSession(binding.key, '')], '重置会话'); }}
          >
            换新会话
          </Button>
        )}
        {confirming ? (
          <>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirming(false)}>取消</Button>
            <Button
              variant="ghost" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled}
              onClick={() => { void onApply(binding.key, [{ op: 'delete', key: binding.key }], '删除绑定'); }}
            >
              确认删除
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" icon={<IconTrashOutlineRegular />} disabled={disabled} onClick={() => setConfirming(true)}>
            删除
          </Button>
        )}
      </div>
    </div>
  );
}
