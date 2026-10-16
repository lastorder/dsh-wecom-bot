import { useState } from 'react';
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Draft, FieldErrors } from '../model.ts';
import { Card, Field } from './ui.tsx';

/** Step 1: the only required inputs, Bot ID and Bot Secret. */
export function CredentialsCard({ draft, errors, secretConfigured, disabled, onChange }: {
  draft: Draft;
  errors: FieldErrors;
  secretConfigured: boolean;
  disabled: boolean;
  onChange(patch: Partial<Draft>): void;
}) {
  const [reveal, setReveal] = useState(false);
  const ready = Boolean(draft.botId.trim()) && (secretConfigured || Boolean(draft.secret.trim()));
  return (
    <Card
      step={1}
      title="连接机器人"
      description="在企业微信管理后台 → 智能机器人 → API 模式（长连接）中获取。这是仅有的两项必填配置。"
      aside={ready ? <Tag tone="success">已填写</Tag> : <Tag tone="danger">必填</Tag>}
    >
      <Field label="Bot ID" required error={errors.botId} hint="机器人的唯一标识，可公开显示。">
        <Input
          className="wcb-grow"
          value={draft.botId}
          placeholder="例如 aib0xxxxxxxxxxxx"
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          aria-label="Bot ID"
          onChange={event => onChange({ botId: event.target.value })}
        />
      </Field>
      <Field
        label="Bot Secret"
        required={!secretConfigured}
        error={errors.secret}
        hint={<>保存到 DSH 凭据库（引用名 <span className="wcb-code">{draft.secretEnv}</span>），不会写入插件配置，也不会回显。{secretConfigured ? '留空表示保持当前 Secret。' : ''}</>}
      >
        <div className="wcb-field-row">
          <Input
            className="wcb-grow"
            type={reveal ? 'text' : 'password'}
            value={draft.secret}
            placeholder={secretConfigured ? '已保存 · 输入新值以替换' : '粘贴 Bot Secret'}
            autoComplete="new-password"
            spellCheck={false}
            disabled={disabled}
            aria-label="Bot Secret"
            onChange={event => onChange({ secret: event.target.value })}
          />
          <Button variant="ghost" size="sm" type="button" onClick={() => setReveal(value => !value)} disabled={!draft.secret}>
            {reveal ? '隐藏' : '显示'}
          </Button>
          {secretConfigured ? <Tag tone="success">已保存</Tag> : <Tag tone="warning">未设置</Tag>}
        </div>
      </Field>
    </Card>
  );
}
