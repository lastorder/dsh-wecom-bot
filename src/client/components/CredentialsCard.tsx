import { useEffect, useState } from 'react';
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { storeCredential } from '../api.ts';
import { useConfigSave, useSecretStatus } from '../hooks.ts';
import { validateCredentials } from '../model.ts';
import type { ClientRemote, ConfigFormScope, StoredConfig } from '../types.ts';
import { Card, Field, SaveBar } from './ui.tsx';

/** Step 1: the only required inputs, Bot ID and Bot Secret. Saves on its own. */
export function CredentialsCard({ scope, base, disabled, remote, onChanged }: {
  scope: ConfigFormScope;
  base: StoredConfig;
  disabled: boolean;
  remote?: ClientRemote;
  onChanged(): void;
}) {
  const [reveal, setReveal] = useState(false);
  const [secret, setSecret] = useState('');
  const [botId, setBotId] = useState(base.botId);
  const [error, setError] = useState<string>();
  const [attempted, setAttempted] = useState(false);
  const save = useConfigSave(scope, onChanged);
  const status = useSecretStatus(remote, base.secretEnv);
  const ready = Boolean(botId.trim()) && (status.configured || Boolean(secret.trim()));
  const dirty = botId.trim() !== base.botId || Boolean(secret.trim());
  const errors = attempted ? validateCredentials({ botId, secret }, status.configured) : {};

  useEffect(() => { setBotId(base.botId); }, [base.botId]);

  async function onSave(): Promise<void> {
    setAttempted(true);
    setError(undefined);
    if (Object.keys(validateCredentials({ botId, secret }, status.configured)).length) return;
    if (!(await save.save({ botId: botId.trim() }))) return;
    if (!secret.trim()) return;
    try {
      await storeCredential(remote?.credentials, base.secretEnv, secret.trim());
      setSecret('');
      status.refresh();
    } catch (cause) {
      setError(`其它配置已保存，但 Secret 保存失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

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
          value={botId}
          placeholder="例如 aib0xxxxxxxxxxxx"
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          aria-label="Bot ID"
          onChange={event => setBotId(event.target.value)}
        />
      </Field>
      <Field
        label="Bot Secret"
        required={!status.configured}
        error={errors.secret}
        hint={<>保存到 DSH 凭据库（引用名 <span className="wcb-code">{base.secretEnv}</span>），不会写入插件配置，也不会回显。{status.configured ? '留空表示保持当前 Secret。' : ''}</>}
      >
        <div className="wcb-field-row">
          <Input
            className="wcb-grow"
            type={reveal ? 'text' : 'password'}
            value={secret}
            placeholder={status.configured ? '已保存 · 输入新值以替换' : '粘贴 Bot Secret'}
            autoComplete="new-password"
            spellCheck={false}
            disabled={disabled}
            aria-label="Bot Secret"
            onChange={event => setSecret(event.target.value)}
          />
          <Button variant="outline" size="sm" type="button" onClick={() => setReveal(value => !value)} disabled={!secret}>
            {reveal ? '隐藏' : '显示'}
          </Button>
          {status.configured ? <Tag tone="success">已保存</Tag> : <Tag tone="warning">未设置</Tag>}
        </div>
      </Field>
      <SaveBar
        dirty={dirty}
        saving={save.saving}
        saved={save.saved}
        error={error ?? save.error}
        disabled={disabled}
        onSave={() => { void onSave(); }}
        onDiscard={() => { setBotId(base.botId); setSecret(''); setError(undefined); setAttempted(false); }}
      />
    </Card>
  );
}
