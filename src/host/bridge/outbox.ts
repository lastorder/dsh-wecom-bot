import type { TemplateCard, WSClient } from '@wecom/aibot-node-sdk';
import type { Logger } from '../dsh.js';
import type { Journal } from '../journal.js';
import type { StatusTracker } from '../status.js';
import { limitBytes, MAX_NOTICE_BYTES } from './format.js';

/**
 * Proactive WeCom messages (`sendMessage`). Messages wait while the socket
 * is not authenticated and are sent one by one; a permanent failure for one
 * recipient never blocks the others. Each attempt becomes one `wecom.send`
 * journal line with the exact request body and the server acknowledgement.
 */

export type NoticeKind =
  | 'turn-complete' | 'session-error' | 'question' | 'review' | 'approval' | 'approval-request' | 'prompt-failed'
  /** Sent by the page when an operator authorizes a sender. */
  | 'authorized'
  /** Sent by the page when an operator moves a sender to another group. */
  | 'group-assigned'
  /** Sent by the page when an operator adds somebody to the administrator list. */
  | 'admin';

export interface Notice {
  readonly chat: string;
  readonly text: string;
  readonly kind: NoticeKind;
  readonly sessionId?: string;
  /** An actionable notice may not outlive this exact pending interaction. */
  readonly interactionNonce?: string;
  /** Sent instead of {@link text} when the client can show a card (approval buttons). */
  readonly card?: TemplateCard;
  readonly roundIds?: readonly string[];
}

export interface Outbox {
  enqueue(notice: Notice): void;
  setOnline(online: boolean): void;
  clear(): void;
  size(): number;
}

export type SendClient = Pick<WSClient, 'sendMessage'>;

export function ackSummary(frame: unknown): Record<string, unknown> | undefined {
  if (!frame || typeof frame !== 'object') return undefined;
  const value = frame as { errcode?: unknown; errmsg?: unknown; headers?: { req_id?: unknown } };
  return {
    ...(value.errcode !== undefined ? { errcode: value.errcode } : {}),
    ...(value.errmsg !== undefined ? { errmsg: value.errmsg } : {}),
    ...(value.headers?.req_id !== undefined ? { reqId: value.headers.req_id } : {}),
  };
}

export function createOutbox(options: {
  readonly client: SendClient;
  readonly journal: Journal;
  readonly log: Logger;
  readonly status: StatusTracker;
  readonly maxQueue?: number;
  /** Re-check live authorization immediately before each queued send. */
  readonly allow?: (notice: Notice) => Promise<boolean>;
}): Outbox {
  const { client, journal, log, status } = options;
  const maxQueue = options.maxQueue ?? 100;
  const queue: Notice[] = [];
  let online = false;
  let sending = false;
  let closed = false;

  async function drain(): Promise<void> {
    if (sending || !online || closed) return;
    sending = true;
    try {
      while (online && !closed && queue.length) {
        const notice = queue.shift()!;
        // A card notice carries buttons; the markdown text stays as the fallback
        // body, because a card the server (or the client) refuses must never
        // swallow the request.
        const body = notice.card
          ? { msgtype: 'template_card' as const, template_card: notice.card }
          : { msgtype: 'markdown' as const, markdown: { content: notice.text } };
        const fallbackBody = notice.card
          ? { msgtype: 'markdown' as const, markdown: { content: notice.text } }
          : undefined;
        const started = Date.now();
        const meta = {
          chatId: notice.chat, kind: notice.kind,
          ...(notice.sessionId ? { sessionId: notice.sessionId } : {}),
          ...(notice.roundIds?.length ? { roundIds: notice.roundIds } : {}),
        };
        try {
          if (options.allow && !await options.allow(notice)) {
            journal.write({ event: 'wecom.send.dropped', ...meta, reason: 'authorization-changed' });
            continue;
          }
          if (closed) return;
          // Authentication may have dropped while the permission lookup ran.
          if (!online) { queue.unshift(notice); return; }
          const ack = await client.sendMessage(notice.chat, body);
          status.count('notifications');
          journal.write({ event: 'wecom.send', ...meta, request: { chatid: notice.chat, body }, response: ackSummary(ack), durationMs: Date.now() - started });
        } catch (error) {
          // A rejected card must not swallow an approval request: fall back to the
          // text form, which carries the same verification code.
          if (fallbackBody) {
            try {
              const ack = await client.sendMessage(notice.chat, fallbackBody);
              // Say why the card did not go: the text alone looks like a design choice.
              journal.write({ event: 'wecom.send', ...meta, request: { chatid: notice.chat, body: fallbackBody }, response: ackSummary(ack), fallback: 'markdown', cardError: error, durationMs: Date.now() - started });
              continue;
            } catch { /* report the card failure below */ }
          }
          status.count('failures');
          // SDK errors may echo the socket URL: keep them out of the DSH log.
          log.warn('WeCom notification send failed');
          journal.write({ event: 'wecom.send', level: 'warn', ...meta, request: { chatid: notice.chat, body }, error, durationMs: Date.now() - started });
        }
      }
    } finally {
      sending = false;
    }
  }

  return {
    enqueue(notice) {
      if (closed) return;
      if (queue.length >= maxQueue) {
        const dropped = queue.shift()!;
        log.warn('WeCom notification queue full; dropping the oldest notification');
        journal.write({ event: 'wecom.send.dropped', level: 'warn', chatId: dropped.chat, kind: dropped.kind });
      }
      queue.push({ ...notice, text: limitBytes(notice.text, MAX_NOTICE_BYTES) });
      void drain();
    },
    setOnline(next) {
      online = next;
      if (next) void drain();
    },
    clear() {
      closed = true;
      queue.length = 0;
    },
    size: () => queue.length,
  };
}
