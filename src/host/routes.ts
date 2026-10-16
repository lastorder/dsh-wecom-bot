import { BINDINGS_ROUTE, STATE_ROUTE, type BindingOp, type BindingsResponse } from '../shared/protocol.js';
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
 * observed WeCom IDs, bindings and Session titles are never served to anyone
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

/** Whether one parsed body entry is a binding op this Host understands. */
function isOp(value: unknown): value is BindingOp {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.op === 'create') return record.kind === 'user' || record.kind === 'group';
  if (record.op === 'delete') return typeof record.key === 'string';
  if (record.op === 'set') return typeof record.key === 'string' && Boolean(record.patch) && typeof record.patch === 'object';
  return false;
}

/**
 * `POST /api/wecom-bot/bindings` — apply settings-page edits to the binding
 * store. Same authenticated channel as the state route; the response carries
 * the fresh table so the page never has to guess what was applied.
 */
export function bindingsRoute(runtime: Pick<Runtime, 'bindingsView' | 'applyBindings'>): FetchRoute {
  return {
    path: BINDINGS_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: '请求体不是 JSON。' } satisfies BindingsResponse, 400);
      }
      const ops = (body as { ops?: unknown } | null)?.ops;
      if (!Array.isArray(ops) || !ops.length) {
        return json({ ok: false, error: '缺少要应用的绑定修改。' } satisfies BindingsResponse, 400);
      }
      if (ops.length > MAX_OPS || !ops.every(isOp)) {
        return json({ ok: false, error: '绑定修改格式不正确。' } satisfies BindingsResponse, 400);
      }
      try {
        const result = await runtime.applyBindings(ops);
        const bindings = await runtime.bindingsView();
        return json({ ok: result.ok, ...(result.error ? { error: result.error } : {}), bindings } satisfies BindingsResponse,
          result.ok ? 200 : 422);
      } catch {
        return json({ ok: false, error: '绑定修改失败，请查看插件日志。' } satisfies BindingsResponse, 500);
      }
    },
  };
}
