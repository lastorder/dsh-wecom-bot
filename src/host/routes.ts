import { STATE_ROUTE } from '../shared/protocol.js';
import type { FetchRoute } from './dsh.js';
import type { Runtime } from './runtime.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

/**
 * `GET /api/wecom-bot/state[?refresh=1]` for the settings page.
 *
 * Registered on DSH's Connection Fetch channel, which authenticates the DSH
 * operator (Host/Origin checks and session cookie) before dispatching, so
 * observed WeCom IDs and Session titles are never served to anyone else.
 */
export function stateRoute(runtime: Pick<Runtime, 'state'>): FetchRoute {
  return {
    path: STATE_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      const refresh = new URL(request.url, 'http://localhost').searchParams.get('refresh') === '1';
      try {
        return new Response(JSON.stringify(await runtime.state({ refresh })), { headers: JSON_HEADERS });
      } catch {
        return new Response(JSON.stringify({ error: 'state unavailable' }), { status: 500, headers: JSON_HEADERS });
      }
    },
  };
}
