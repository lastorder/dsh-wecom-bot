import { ROUTING_ROUTE, STATE_ROUTE, type RoutingOp, type RoutingResponse } from '../shared/protocol.js';
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

/** Whether one parsed body entry is a routing op this Host understands. */
function isOp(value: unknown): value is RoutingOp {
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
    case 'member.remove':
      return typeof record.key === 'string';
    default:
      return false;
  }
}

/**
 * `POST /api/wecom-bot/routing` — apply settings-page edits to groups and
 * members. Same authenticated channel as the state route; the response carries
 * the fresh table so the page never has to guess what was applied.
 */
export function routingRoute(runtime: Pick<Runtime, 'routingView' | 'applyRouting'>): FetchRoute {
  return {
    path: ROUTING_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: '请求体不是 JSON。' } satisfies RoutingResponse, 400);
      }
      const ops = (body as { ops?: unknown } | null)?.ops;
      if (!Array.isArray(ops) || !ops.length) {
        return json({ ok: false, error: '缺少要应用的修改。' } satisfies RoutingResponse, 400);
      }
      if (ops.length > MAX_OPS || !ops.every(isOp)) {
        return json({ ok: false, error: '修改格式不正确。' } satisfies RoutingResponse, 400);
      }
      try {
        const result = await runtime.applyRouting(ops);
        const routing = await runtime.routingView();
        return json({ ok: result.ok, ...(result.error ? { error: result.error } : {}), routing } satisfies RoutingResponse,
          result.ok ? 200 : 422);
      } catch {
        return json({ ok: false, error: '修改失败，请查看插件日志。' } satisfies RoutingResponse, 500);
      }
    },
  };
}
