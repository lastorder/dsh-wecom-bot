import type { WsFrame } from '@wecom/aibot-node-sdk';
import { validIdentifier } from './format.js';

/**
 * Validated identity of one `aibot_msg_callback` frame. Frames for another
 * Bot, with malformed or control-character IDs, or of an unknown chat type
 * are dropped before anything is recorded.
 */
export interface InboundMessage {
  readonly frame: WsFrame;
  readonly reqId: string;
  readonly msgId: string;
  readonly chat: string;
  readonly user: string;
  readonly chatType: 'single' | 'group';
  readonly msgtype: string;
  /** Text content of `text` messages (untrimmed). */
  readonly text?: string;
}

export function parseInbound(frame: WsFrame | undefined, botId: string): InboundMessage | null {
  if (frame?.cmd !== 'aibot_msg_callback' || !validIdentifier(frame.headers?.req_id, 512)) return null;
  const body = frame.body as Record<string, unknown> | undefined;
  if (!body || body.aibotid !== botId || !validIdentifier(body.msgid, 512)) return null;
  if (typeof body.msgtype !== 'string' || !body.msgtype) return null;
  if (body.chattype !== 'single' && body.chattype !== 'group') return null;
  const user = (body.from as { userid?: unknown } | undefined)?.userid;
  if (!validIdentifier(user)) return null;
  const chat = body.chattype === 'group' ? body.chatid : user;
  if (!validIdentifier(chat)) return null;
  const text = body.msgtype === 'text' ? (body.text as { content?: unknown } | undefined)?.content : undefined;
  return {
    frame,
    reqId: frame.headers.req_id,
    msgId: body.msgid,
    chat,
    user,
    chatType: body.chattype,
    msgtype: body.msgtype,
    ...(typeof text === 'string' ? { text } : {}),
  };
}

/** Bounded replay guard for callback `msgid`s. */
export function createReplayGuard(windowMs = 5 * 60 * 1000, maxEntries = 1000) {
  const seen = new Map<string, number>();
  return {
    /** True the first time an id is seen within the window. */
    first(id: string, now = Date.now()): boolean {
      for (const [key, time] of seen) {
        if (time > now - windowMs && seen.size <= maxEntries) break;
        seen.delete(key);
      }
      if (seen.has(id)) return false;
      seen.set(id, now);
      return true;
    },
  };
}
