import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import type { BridgeStateView, ConnectionPhase } from '../../shared/protocol.ts';
import { relativeTime } from '../model.ts';

const PHASES: Record<ConnectionPhase, { label: string; tone: 'ok' | 'warn' | 'err' | 'idle'; dot: 'done' | 'warning' | 'ongoing' | 'error' | 'idle' }> = {
  unconfigured: { label: '未配置', tone: 'idle', dot: 'idle' },
  invalid: { label: '配置无效', tone: 'err', dot: 'error' },
  connecting: { label: '连接中', tone: 'warn', dot: 'ongoing' },
  online: { label: '在线', tone: 'ok', dot: 'done' },
  reconnecting: { label: '重连中', tone: 'warn', dot: 'ongoing' },
  offline: { label: '已断开', tone: 'warn', dot: 'warning' },
  displaced: { label: '被其他连接替换', tone: 'err', dot: 'error' },
  error: { label: '连接错误', tone: 'err', dot: 'error' },
};

export function StatusHeader({ state, error }: { state?: BridgeStateView; error?: string }) {
  const phase = state ? PHASES[state.connection.phase] ?? PHASES.error : undefined;
  const traffic = state?.traffic;
  const detail = error ?? state?.connection.detail;
  return (
    <header className="wcb-hero">
      <div className="wcb-hero-mark" aria-hidden="true">企</div>
      <div className="wcb-hero-text">
        <div className="wcb-hero-title">企业微信机器人</div>
        <div className="wcb-hero-sub">在企业微信里接收 DSH 的完成通知与提问，直接回复即可继续对应会话。</div>
      </div>
      <div className="wcb-hero-status">
        <span className="wcb-pill" data-tone={error ? 'err' : phase?.tone ?? 'idle'} role="status">
          <StateDot state={error ? 'error' : phase?.dot ?? 'ongoing'} />
          {error ? '状态不可用' : phase ? phase.label : '读取状态…'}
          {state && !error && <span style={{ fontWeight: 400, opacity: 0.75 }}>· {relativeTime(state.connection.since)}</span>}
        </span>
        {detail && <span className="wcb-status-detail">{detail}</span>}
      </div>
      {traffic && (
        <div className="wcb-stats" aria-label="本次 DSH 启动以来的统计">
          <Stat value={traffic.received} label={`收到消息${traffic.lastMessageAt ? ` · ${relativeTime(traffic.lastMessageAt)}` : ''}`} />
          <Stat value={traffic.rejected} label="已拒绝" />
          <Stat value={traffic.prompts} label="提交到 DSH" />
          <Stat value={traffic.notifications} label="推送通知" />
        </div>
      )}
    </header>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="wcb-stat">
      <div className="wcb-stat-value">{value}</div>
      <div className="wcb-stat-label">{label}</div>
    </div>
  );
}
