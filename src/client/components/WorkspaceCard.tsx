import { useState } from 'react';
import { IconFolderCloseRegular, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import type { BridgeStateView, ModelCatalogView, ModelChoice } from '../../shared/protocol.ts';
import {
  choiceLabel, displayPath, dshDefaultLabel, effortsFor, modelKey, parseModelKey, relativeTime,
  type Draft, type FieldErrors,
} from '../model.ts';
import { Card, Field, Select } from './ui.tsx';

const CUSTOM = '\u0000custom';

/** Step 2: which Workspace (and model) new WeCom Sessions are created in. */
export function WorkspaceCard({ draft, errors, state, disabled, onChange }: {
  draft: Draft;
  errors: FieldErrors;
  state: BridgeStateView | undefined;
  disabled: boolean;
  onChange(patch: Partial<Draft>): void;
}) {
  const workspaces = state?.workspaces ?? [];
  const catalog = state?.models;
  const known = workspaces.some(workspace => workspace.path === draft.defaultWorkspace);
  const [custom, setCustom] = useState(false);
  const customVisible = custom || (Boolean(draft.defaultWorkspace) && !known);
  const modelValue = modelKey(draft.defaultProvider, draft.defaultModel);
  const efforts = effortsFor(catalog, draft.defaultProvider, draft.defaultModel);
  const effective = state?.defaults;

  return (
    <Card
      step={2}
      title="默认 Workspace 与模型"
      description="企业微信里的每个用户/群都会在这个 Workspace 里拥有自己的 DSH 会话。留空则自动使用 DSH home 下 wecom-bot/workspace（会自动创建并注册到侧边栏）。"
    >
      <Field
        label="默认 Workspace"
        error={errors.defaultWorkspace}
        hint={effective?.workspaceError
          ? <span className="wcb-inline-error">{effective.workspaceError}</span>
          : <>实际路径：<span className="wcb-code">{displayPath(effective?.workspacePath) || '（尚未创建）'}</span>{effective?.workspaceTitle ? ` · 侧边栏名称「${effective.workspaceTitle}」` : ''}</>}
      >
        <Select
          value={customVisible ? CUSTOM : draft.defaultWorkspace}
          disabled={disabled}
          aria-label="默认 Workspace"
          onChange={event => {
            if (event.target.value === CUSTOM) { setCustom(true); return; }
            setCustom(false);
            onChange({ defaultWorkspace: event.target.value });
          }}
        >
          <option value="">自动（DSH home 下的 wecom-bot/workspace）</option>
          {workspaces.map(workspace => (
            <option key={workspace.path} value={workspace.path}>
              {workspace.title} — {displayPath(workspace.path)}{workspace.pluginOwned ? '（插件目录）' : ''}
            </option>
          ))}
          <option value={CUSTOM}>自定义路径…</option>
        </Select>
        {customVisible && (
          <div className="wcb-field-row" style={{ marginTop: 8 }}>
            <Input
              className="wcb-grow"
              value={draft.defaultWorkspace}
              placeholder="/absolute/path/to/workspace"
              spellCheck={false}
              disabled={disabled}
              aria-label="自定义 Workspace 路径"
              onChange={event => onChange({ defaultWorkspace: event.target.value })}
            />
            <span className="wcb-hint">目录必须已存在</span>
          </div>
        )}
      </Field>

      <Field
        label="默认模型"
        error={errors.defaultModel}
        hint={<>新建会话时安装到该会话的模型；留空沿用 DSH 当前默认模型。列表来自 DSH 的模型目录（{catalog ? `更新于 ${relativeTime(catalog.fetchedAt)}` : '读取中…'}）。</>}
      >
        <Select
          className="wcb-grow"
          value={modelValue}
          disabled={disabled || !catalog}
          aria-label="默认模型"
          onChange={event => {
            const next = parseModelKey(event.target.value);
            onChange({ defaultProvider: next.provider, defaultModel: next.model, defaultReasoningEffort: '' });
          }}
        >
          <option value="">{dshDefaultLabel(catalog)}</option>
          {groupChoices(catalog).map(group => (
            <optgroup key={group.provider} label={group.providerName}>
              {group.choices.map(choice => (
                <option key={modelKey(choice.provider, choice.model)} value={modelKey(choice.provider, choice.model)}>
                  {choiceLabel(choice)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      {efforts.length > 0 && (
        <Field label="思考强度" hint="该模型支持的推理强度；留空使用模型默认值。">
          <Select
            value={draft.defaultReasoningEffort}
            disabled={disabled}
            aria-label="默认思考强度"
            onChange={event => onChange({ defaultReasoningEffort: event.target.value })}
          >
            <option value="">模型默认</option>
            {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}（{effort.id}）</option>)}
          </Select>
        </Field>
      )}

      {catalog?.failures.length ? (
        <div className="wcb-list-foot">
          <span className="wcb-inline-error">
            有 {catalog.failures.length} 个服务商的模型列表读取失败：{catalog.failures.map(failure => `${failure.name}（${failure.message}）`).join('；')}
          </span>
        </div>
      ) : null}

      <div className="wcb-list-foot">
        <span><IconFolderCloseRegular size={12} /> 会话按 Workspace 分组显示，可在下方为每个用户/群单独指定。</span>
      </div>
    </Card>
  );
}

function groupChoices(catalog: ModelCatalogView | null | undefined): { provider: string; providerName: string; choices: ModelChoice[] }[] {
  const groups = new Map<string, { provider: string; providerName: string; choices: ModelChoice[] }>();
  for (const choice of catalog?.choices ?? []) {
    const group = groups.get(choice.provider) ?? { provider: choice.provider, providerName: choice.providerName, choices: [] };
    group.choices.push(choice);
    groups.set(choice.provider, group);
  }
  return [...groups.values()];
}
