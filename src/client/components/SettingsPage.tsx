import { useMemo } from 'react';
import { useBridgeState, useFormSnapshot } from '../hooks.ts';
import { storedFrom } from '../model.ts';
import type { ClientRemote, ConfigFormScope, FormSnapshot } from '../types.ts';
import { AdminCard } from './AdminCard.tsx';
import { AdvancedCard } from './AdvancedCard.tsx';
import { CredentialsCard } from './CredentialsCard.tsx';
import { GroupsCard } from './GroupsCard.tsx';
import { RejectedCard } from './RejectedCard.tsx';
import { StatusHeader } from './StatusHeader.tsx';

/**
 * Plugin homepage (`plugins.bundle.config`, view `page`).
 *
 * Each card saves its own section: 连接 saves the Bot ID (and writes the
 * Secret to the credential store), 管理员 saves its own list, 高级设置 saves
 * the knobs, while groups, members and notes apply immediately on the Host.
 * There is no page-wide 保存配置 — nothing waits at the bottom of the page.
 */
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

function SettingsEditor({ snapshot, scope, remote }: { snapshot: FormSnapshot; scope: ConfigFormScope; remote?: ClientRemote }) {
  // The revision identifies the stored value; the snapshot object may be recreated.
  const base = useMemo(() => storedFrom(snapshot.value), [snapshot.revision]);
  const bridge = useBridgeState();
  const writable = snapshot.writable !== false;
  const state = bridge.data;
  const onChanged = () => bridge.refresh(true);

  return (
    <div className="wcb-page">
      <StatusHeader state={state} error={bridge.error} />
      {state?.notices.map(notice => (
        <div className="wcb-banner" data-tone="warning" role="status" key={notice}>
          <div><div className="wcb-banner-body">{notice}</div></div>
        </div>
      ))}
      <CredentialsCard scope={scope} base={base} disabled={!writable} remote={remote} onChanged={onChanged} />
      <GroupsCard
        state={state}
        error={bridge.error}
        disabled={!writable}
        refreshing={bridge.refreshing}
        onRefresh={() => bridge.refresh(true)}
        onChanged={onChanged}
      />
      <RejectedCard state={state} disabled={!writable} onChanged={onChanged} />
      <AdminCard scope={scope} base={base} state={state} disabled={!writable} onChanged={onChanged} />
      <AdvancedCard scope={scope} base={base} journal={state?.journal} disabled={!writable} onChanged={onChanged} />
    </div>
  );
}
