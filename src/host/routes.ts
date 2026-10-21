import { STORE_ROUTE, STATE_ROUTE, type StoreOp, type StoreResponse } from '../shared/protocol.js';
import type { FetchRoute } from './dsh.js';
import type { Runtime } from './runtime.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const MAX_OPS = 200;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * `GET /api/wecom-bot/state[?refresh=1]` for the settings page.
 *
 * Registered on DSH's Connection Fetch channel, which authenticates the DSH
 * operator (Host/Origin checks and session cookie) before dispatching, so
 * rejected WeCom IDs, groups and Session titles are never served to anyone
 * else.
 */
export function stateRoute(runtime: Pick<Runtime, 'state'>): FetchRoute {
  return {
    path: STATE_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      const refresh = new URL(request.url, 'http://localhost').searchParams.get('refresh') === '1';
      try {
        return json(await runtime.state({ refresh }));
      } catch {
        return json({ error: 'state unavailable' }, 500);
      }
    },
  };
}

/**
 * Whether one parsed body entry is a store op this Host understands.
 *
 * Every {@link StoreOp} variant must be accepted here: the route rejects a whole
 * batch for one unknown op, so a missing case silently disables a page feature (a
 * 备注 edit, say) while the client keeps offering it.
 */
export function isStoreOp(value: unknown): value is StoreOp {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  switch (record.op) {
    case 'group.add':
      return record.name === undefined || typeof record.name === 'string';
    case 'group.update':
      return typeof record.id === 'string' && Boolean(record.patch) && typeof record.patch === 'object';
    case 'group.delete':
      return typeof record.id === 'string';
    case 'member.add':
      return typeof record.groupId === 'string' && (record.kind === 'user' || record.kind === 'group');
    case 'member.update':
      return typeof record.key === 'string' && Boolean(record.patch) && typeof record.patch === 'object';
    case 'member.model':
      return typeof record.key === 'string' && typeof record.sessionId === 'string'
        && Boolean(record.selection) && typeof record.selection === 'object' && !Array.isArray(record.selection);
    case 'member.remove':
    case 'member.archive':
      return typeof record.key === 'string';
    case 'label.set':
      return typeof record.key === 'string' && typeof record.label === 'string';
    // The field-by-field validation belongs to `validateSettingsPatch`: this
    // guard only answers "is this an op this Host knows at all".
    case 'settings.set':
      return Boolean(record.patch) && typeof record.patch === 'object' && !Array.isArray(record.patch);
    default:
      return false;
  }
}

/**
 * `POST /api/wecom-bot/store` — apply settings-page edits to the plugin's own
 * document: the settings block, the groups, the members and the notes. Same
 * authenticated channel as the state route; the response carries the fresh table
 * so the page never has to guess what was applied.
 */
export function storeRoute(runtime: Pick<Runtime, 'routingView' | 'applyOps'>): FetchRoute {
  return {
    path: STORE_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: '请求体不是 JSON。' } satisfies StoreResponse, 400);
      }
      const ops = (body as { ops?: unknown } | null)?.ops;
      if (!Array.isArray(ops) || !ops.length) {
        return json({ ok: false, error: '缺少要应用的修改。' } satisfies StoreResponse, 400);
      }
      if (ops.length > MAX_OPS || !ops.every(isStoreOp)) {
        return json({ ok: false, error: '修改格式不正确。' } satisfies StoreResponse, 400);
      }
      try {
        const result = await runtime.applyOps(ops);
        const routing = await runtime.routingView();
        return json({ ok: result.ok, ...(result.error ? { error: result.error } : {}), routing } satisfies StoreResponse,
          result.ok ? 200 : 422);
      } catch {
        return json({ ok: false, error: '修改失败，请查看插件日志。' } satisfies StoreResponse, 500);
      }
    },
  };
}
