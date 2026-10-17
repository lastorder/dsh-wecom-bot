import { useEffect, useState } from 'react';
import {
  Button, IconChevronRightOutlineRegular, IconCopyOutlineRegular, Input, Switch, Tag, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { JournalInfo, StoreSettings } from '../../shared/protocol.ts';
import { useStoreSettingsSave } from '../hooks.ts';
import { advancedSlice, settingsPatch, validateAdvanced } from '../model.ts';
import { CardHead, Field, SaveBar } from './ui.tsx';

/**
 * Step 5 (collapsed): approvals, timeouts, custom endpoint and the JSONL journal.
 *
 * These five are the store's settings block, edited through the same immediate
 * channel as the groups. The one exception in spirit is the endpoint: the
 * WebSocket address is half of the connection, so writing it is the only edit on
 * this card that reconnects the Bot. The card therefore keeps an explicit 保存 /
 * 放弃 bar and writes one patch for the fields that moved.
 */
export function AdvancedCard({ settings, journal, disabled, onChanged }: {
  settings: StoreSettings | undefined;
  journal: JournalInfo | undefined;
  disabled: boolean;
  onChanged(): void;
}) {
  const stored = advancedSlice(settings);
  const [draft, setDraft] = useState(() => advancedSlice(settings));
  const [attempted, setAttempted] = useState(false);
  const [copied, setCopied] = useState(false);
  const save = useStoreSettingsSave(onChanged);
  const patch = settingsPatch(draft, stored);
  const dirty = Object.keys(patch).length > 0;
  const errors = attempted ? validateAdvanced(draft) : {};

  // Rebase on the store's copy whenever its values move, keyed by the values so
  // a poll repeating what this card already shows leaves the draft alone.
  const storedKey = JSON.stringify(stored);
  useEffect(() => { setDraft(advancedSlice(settings)); }, [storedKey]);

  const copy = async (): Promise<void> => {
    if (!journal?.directory) return;
    setCopied(await writeClipboard(journal.directory));
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <details className="wcb-card wcb-details">
      <summary>
        <CardHead
          step={5}
          title={<>高级设置 {draft.remoteApprovals && <Tag tone="warning">远程审批已开启</Tag>}</>}
          description="远程审批、等待时间、自定义连接地址与对话日志。均可保持默认。"
          aside={<span className="wcb-chevron"><IconChevronRightOutlineRegular size={16} /></span>}
        />
      </summary>

      <Field
        label="远程审批工具调用"
        hint="开启后，DSH 请求执行工具时会通知所有管理员，管理员在单聊里回复 /approve 或 /deny 即生效；群聊永远不能审批。关闭时只通知，审批仍需到 DSH 页面完成。"
      >
        <Switch checked={draft.remoteApprovals} disabled={disabled} label="远程审批工具调用"
          onChange={next => setDraft(current => ({ ...current, remoteApprovals: next }))} />
      </Field>

      <Field label="等待企微回复（秒）" error={errors.questionTimeoutMs}
        hint="DSH 提问或审批时，先等待企业微信回复的时间；超时后回到 DSH 页面处理。">
        <Input
          className="wcb-number"
          type="number" min={1} max={300} step={1}
          value={Math.round(draft.questionTimeoutMs / 1000)}
          disabled={disabled}
          aria-label="等待企微回复的秒数"
          onChange={event => setDraft(current => ({ ...current, questionTimeoutMs: Number(event.target.value) * 1000 }))}
        />
      </Field>

      <Field
        label="WebSocket 地址"
        error={errors.wsUrl}
        hint="留空使用 SDK 默认地址。仅在企业私有化部署时需要，只接受 wss://。保存这一项会重新连接机器人——它是连接的一半；本卡其余设置保存后立即生效，不会断开正在进行的对话。"
      >
        <Input
          className="wcb-grow"
          value={draft.wsUrl}
          placeholder="wss://openws.work.weixin.qq.com"
          spellCheck={false}
          disabled={disabled}
          aria-label="WebSocket 地址"
          onChange={event => setDraft(current => ({ ...current, wsUrl: event.target.value }))}
        />
      </Field>

      <Field
        label="对话日志（JSONL）"
        hint={<>每条企微消息一行 <span className="wcb-code">round.complete</span>，含原始请求、回复与元数据；另有 <span className="wcb-code">wecom.message</span>、<span className="wcb-code">dsh.prompt</span>、<span className="wcb-code">dsh.turn.end</span>、<span className="wcb-code">wecom.send</span> 等明细行。Secret、回调 URL 与媒体密钥会被脱敏；文件权限仅当前用户可读。</>}
      >
        <div className="wcb-field-row">
          <Switch checked={draft.logEnabled} disabled={disabled} label="记录对话日志"
            onChange={next => setDraft(current => ({ ...current, logEnabled: next }))} />
          <span style={{ color: 'var(--wcb-text-2)', fontSize: 13 }}>保留</span>
          <Input
            className="wcb-number"
            type="number" min={1} max={365} step={1}
            value={draft.logRetentionDays}
            disabled={disabled || !draft.logEnabled}
            aria-label="日志保留天数"
            onChange={event => setDraft(current => ({ ...current, logRetentionDays: Number(event.target.value) }))}
          />
          <span style={{ color: 'var(--wcb-text-2)', fontSize: 13 }}>天</span>
        </div>
        {errors.logRetentionDays && <div className="wcb-field-error">{errors.logRetentionDays}</div>}
        {journal?.directory && (
          <div className="wcb-field-row" style={{ marginTop: 10 }}>
            <div className="wcb-path wcb-grow" title={journal.file}>{journal.directory}</div>
            <Button variant="ghost" size="sm" icon={<IconCopyOutlineRegular />} onClick={() => { void copy(); }}>
              {copied ? '已复制' : '复制路径'}
            </Button>
          </div>
        )}
      </Field>

      <SaveBar
        dirty={dirty}
        saving={save.saving}
        saved={save.saved}
        error={save.error}
        disabled={disabled}
        onSave={() => { setAttempted(true); if (dirty) void save.save(patch); }}
        onDiscard={() => { setDraft(advancedSlice(settings)); setAttempted(false); }}
      />
    </details>
  );
}
