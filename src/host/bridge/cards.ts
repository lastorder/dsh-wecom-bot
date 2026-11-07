import type { WsFrame } from '@wecom/aibot-node-sdk';

/**
 * Button keys and `task_id` plumbing for approval cards.
 *
 * A tool approval used to be answered by typing `/approve <nonce>` back into
 * the chat. On a phone that means copying a code out of a message first, so the
 * same request now also travels as a `button_interaction` card: the nonce rides
 * inside the card's `task_id`, and the two buttons carry the verdict. The text
 * form stays available — the card is a convenience, never the only way in.
 */

/** Button the administrator taps to allow the call once. */
export const APPROVE_BUTTON = 'approve';
/** Button the administrator taps to reject the call. */
export const DENY_BUTTON = 'deny';
/** The only button left on a settled card: nothing happens when tapped. */
export const SETTLED_BUTTON = 'settled';

const TASK_PREFIX = 'apv_';

/** WeCom echoes `task_id` on every click, so the nonce travels with the card. */
export function approvalTaskId(nonce: string): string {
  return `${TASK_PREFIX}${nonce}`;
}

export interface CardEvent {
  /** Which button was tapped; undefined for a card this plugin did not send. */
  readonly action?: 'approve' | 'deny';
  /** The verification code carried by the card, empty when the id is foreign. */
  readonly nonce: string;
  readonly taskId: string;
  readonly userId: string;
  /** Single chats answer without `chatid`, in which case the sender is the chat. */
  readonly chatId: string;
}

/**
 * Read a `template_card_event` frame.
 *
 * The payload nests button data differently per card type, and a frame can
 * arrive for a card another integration sent, so nothing here trusts a field to
 * exist: an unknown button or a `task_id` without our prefix yields no action
 * and no nonce, which the caller treats as ignorable.
 */
export function parseCardEvent(frame: WsFrame | undefined): CardEvent {
  const body = (frame?.body ?? {}) as {
    from?: { userid?: unknown };
    chatid?: unknown;
    userid?: unknown;
    event?: { event_key?: unknown; task_id?: unknown; template_card_event?: { event_key?: unknown; task_id?: unknown } };
  };
  const event = body.event ?? {};
  const card = event.template_card_event ?? {};
  const key = card.event_key ?? event.event_key;
  const taskId = card.task_id ?? event.task_id;
  const userId = typeof body.from?.userid === 'string' ? body.from.userid : typeof body.userid === 'string' ? body.userid : '';
  const chatId = typeof body.chatid === 'string' ? body.chatid : userId;
  const action = key === APPROVE_BUTTON ? 'approve' : key === DENY_BUTTON ? 'deny' : undefined;
  const id = typeof taskId === 'string' ? taskId : '';
  const nonce = id.startsWith(TASK_PREFIX) ? id.slice(TASK_PREFIX.length) : '';
  return { ...(action ? { action } : {}), nonce, taskId: id, userId, chatId };
}
