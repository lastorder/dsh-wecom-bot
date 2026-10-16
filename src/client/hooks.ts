/** React hooks binding the page to DSH Config forms, credentials and the state route. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BridgeStateView } from '../shared/protocol.ts';
import { describeCredential, fetchState } from './api.ts';
import type { ClientRemote, ConfigFormScope, FormSnapshot } from './types.ts';

export function useFormSnapshot(scope: ConfigFormScope): FormSnapshot {
  return useSyncExternalStore(listener => scope.subscribe(listener), () => scope.getSnapshot());
}

export interface BridgeState {
  readonly data?: BridgeStateView;
  readonly error?: string;
  readonly loading: boolean;
  readonly refreshing: boolean;
  /** Re-read now; `force` also bypasses the Host's Session cache. */
  refresh(force?: boolean): void;
}

/** Poll the Host state route while the page is visible. */
export function useBridgeState(intervalMs = 5000): BridgeState {
  const [data, setData] = useState<BridgeStateView>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const tick = useRef<(force: boolean) => void>(() => {});

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let inflight = false;
    async function load(force: boolean): Promise<void> {
      if (inflight || (!force && typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
      inflight = true;
      if (force) setRefreshing(true);
      try {
        const next = await fetchState(force, controller.signal);
        if (!active) return;
        setData(next);
        setError(undefined);
      } catch (cause) {
        if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        inflight = false;
        if (active) { setLoading(false); setRefreshing(false); }
      }
    }
    tick.current = force => { void load(force); };
    void load(true);
    const timer = setInterval(() => { void load(false); }, intervalMs);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [intervalMs]);

  const refresh = useCallback((force = true) => tick.current(force), []);
  return { data, error, loading, refreshing, refresh };
}

export interface SecretStatus {
  readonly configured: boolean;
  readonly known: boolean;
  refresh(): void;
}

/** Whether the credential reference holds a value; never reads the value itself. */
export function useSecretStatus(remote: ClientRemote | undefined, ref: string): SecretStatus {
  const [configured, setConfigured] = useState(false);
  const [known, setKnown] = useState(false);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    let active = true;
    describeCredential(remote?.credentials, ref)
      .then(info => { if (active) { setConfigured(Boolean(info?.configured)); setKnown(info !== undefined); } })
      .catch(() => { if (active) { setConfigured(false); setKnown(false); } });
    return () => { active = false; };
  }, [remote, ref, version]);

  useEffect(() => remote?.$on?.('credentials/reference-updated', updated => {
    if (updated === ref) refresh();
  }), [remote, ref, refresh]);

  return { configured, known, refresh };
}
