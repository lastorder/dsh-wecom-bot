import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { storeCredential } from '../api.ts';
import { useBridgeState, useFormSnapshot, useSecretStatus } from '../hooks.ts';
import {
  accessSummary, changedOperations, draftFrom, isDirty, storedFrom, validate, type Draft,
} from '../model.ts';
import type { ClientRemote, ConfigFormScope, FormSnapshot } from '../types.ts';
import { AccessBanner } from './AccessBanner.tsx';
import { AdminCard } from './AdminCard.tsx';
import { AdvancedCard } from './AdvancedCard.tsx';
import { BindingsCard } from './BindingsCard.tsx';
import { CredentialsCard } from './CredentialsCard.tsx';
import { IdentityPicker } from './IdentityPicker.tsx';
import { StatusHeader } from './StatusHeader.tsx';
import { WorkspaceCard } from './WorkspaceCard.tsx';

/** Plugin homepage (`plugins.bundle.config`, view `page`). */
export function SettingsPage({ scope, remote }: { scope: ConfigFormScope; remote?: ClientRemote }) {
  const snapshot = useFormSnapshot(scope);
  if (snapshot.status !== 'ready') {
    return (
      <div className="wcb-page">
        <div className="wcb-card">{snapshot.status === 'loading' ? '正在加载插件配置…' : '插件配置暂不可用：请确认插件已启用。'}</div>
      </div>
    );
  }
  return <SettingsEditor snapshot={snapshot} scope={scope} remote={remote} />;
}

type SaveState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'saving' }
  | { readonly phase: 'saved' }
  | { readonly phase: 'error'; readonly message: string };

function SettingsEditor({ snapshot, scope, remote }: { snapshot: FormSnapshot; scope: ConfigFormScope; remote?: ClientRemote }) {
  // The revision identifies the stored value; the snapshot object may be recreated.
  const base = useMemo(() => storedFrom(snapshot.value), [snapshot.revision]);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(base));
  const [save, setSave] = useState<SaveState>({ phase: 'idle' });
  const [showErrors, setShowErrors] = useState(false);
  const baseRef = useRef(base);
  const bridge = useBridgeState();
  const secret = useSecretStatus(remote, base.secretEnv);
  const writable = snapshot.writable !== false;
  const busy = save.phase === 'saving';
  const state = bridge.data;

  // Follow edits made elsewhere (another window, a Host write, the raw Config
  // editor) unless the user has unsaved changes here.
  useEffect(() => {
    const previous = baseRef.current;
    baseRef.current = base;
    setDraft(current => (isDirty({ ...current, secret: '' }, previous) ? current : { ...draftFrom(base), secret: current.secret }));
  }, [base]);

  const errors = validate(draft, secret.configured);
  const invalid = Object.keys(errors).length > 0;
  const dirty = isDirty(draft, base);
  const summary = accessSummary(draft);
  const update = (patch: Partial<Draft>) => {
    setDraft(current => ({ ...current, ...patch }));
    if (save.phase !== 'saving') setSave({ phase: 'idle' });
  };

  /**
   * Write the Config diff. A revision conflict means something else wrote the
   * namespace (the Host re-reading its own settings, another window): re-read
   * and rebase the same diff onto the newest revision instead of giving up.
   */
  async function persist(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = scope.getSnapshot();
      const ops = changedOperations(draft, storedFrom(latest.value));
      if (!ops.length) return;
      if (await scope.mutate(ops, latest.revision)) return;
    }
    throw new Error('配置已在别处被修改，请刷新页面后重试。');
  }

  async function onSave(): Promise<void> {
    if (invalid) { setShowErrors(true); return; }
    setSave({ phase: 'saving' });
    try {
      await persist();
      if (draft.secret.trim()) {
        try {
          await storeCredential(remote?.credentials, base.secretEnv, draft.secret.trim());
        } catch (error) {
          throw new Error(`其他配置已保存，但 Secret 保存失败：${error instanceof Error ? error.message : String(error)}`);
        }
        setDraft(current => ({ ...current, secret: '' }));
        secret.refresh();
      }
      setShowErrors(false);
      setSave({ phase: 'saved' });
      setTimeout(() => bridge.refresh(true), 800);    } catch (error) {
      setSave({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  const visibleErrors = showErrors ? errors : {};
  const footer = !writable ? { tone: 'error', text: '此部署的设置为只读。' }
    : save.phase === 'error' ? { tone: 'error', text: save.message }
    : showErrors && invalid ? { tone: 'error', text: '请先修正标红的字段。' }
    : busy ? { tone: '', text: '正在保存…' }
    : dirty ? { tone: 'dirty', text: '有未保存的更改（会话绑定除外，它即时生效）' }
    : save.phase === 'saved' ? { tone: 'success', text: '已保存，机器人会按新配置重新连接。' }
    : { tone: '', text: '所有更改均已保存。' };

  return (
    <div className="wcb-page">
      <StatusHeader state={state} error={bridge.error} />
      {state?.notices.map(notice => (
        <div className="wcb-banner" data-tone="warning" role="status" key={notice}>
          <div><div className="wcb-banner-body">{notice}</div></div>
        </div>
      ))}
      <AccessBanner
        summary={summary}
        admins={state?.admins ?? draft.adminUserIds}
        adminWorkspaces={state?.adminWorkspaces ?? draft.adminWorkspaces}
        workspace={state?.defaults.workspacePath || (draft.defaultWorkspace || undefined)}
      />
      <CredentialsCard
        draft={draft}
        errors={visibleErrors}
        secretConfigured={secret.configured}
        disabled={!writable || busy}
        onChange={update}
      />
      <WorkspaceCard
        draft={draft}
        errors={visibleErrors}
        state={state}
        disabled={!writable || busy}
        onChange={update}
      />
      <BindingsCard
        state={state}
        error={bridge.error}
        disabled={!writable}
        refreshing={bridge.refreshing}
        onRefresh={() => bridge.refresh(true)}
        onChanged={() => bridge.refresh(true)}
      />
      <IdentityPicker
        observed={state?.observed}
        chatIds={draft.chatIds}
        userIds={draft.allowedUserIds}
        disabled={!writable || busy}
        connected={state?.connection.phase === 'online'}
        onChange={patch => update(patch)}
      />
      <AdminCard
        draft={draft}
        observed={state?.observed}
        workspaces={state?.workspaces ?? []}
        disabled={!writable || busy}
        onChange={patch => update(patch)}
      />
      <AdvancedCard
        draft={draft}
        errors={visibleErrors}
        journal={state?.journal}
        disabled={!writable || busy}
        onChange={update}
      />
      <div className="wcb-footer">
        <div className="wcb-footer-msg" data-tone={footer.tone || undefined} role="status">{footer.text}</div>
        <Button variant="outline" size="sm" disabled={!dirty || busy} onClick={() => { setDraft(draftFrom(base)); setShowErrors(false); setSave({ phase: 'idle' }); }}>
          放弃更改
        </Button>
        <Button variant="primary" size="sm" disabled={!writable || busy || !dirty} onClick={() => { void onSave(); }}>
          {busy ? '保存中…' : '保存配置'}
        </Button>
      </div>
    </div>
  );
}
