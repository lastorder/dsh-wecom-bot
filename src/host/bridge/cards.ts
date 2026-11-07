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

/** Option buttons of a question card are `opt_<0-based index>`. */
const OPTION_PREFIX = 'opt_';
/** The most buttons WeCom lets one card carry. */
export const MAX_CARD_BUTTONS = 6;

const TASK_PREFIX = 'apv_';
const QUESTION_PREFIX = 'qst_';

/** WeCom echoes `task_id` on every click, so the nonce travels with the card. */
export function approvalTaskId(nonce: string): string {
  return `${TASK_PREFIX}${nonce}`;
}

export function questionTaskId(nonce: string): string {
  return `${QUESTION_PREFIX}${nonce}`;
}

export function optionButton(index: number): string {
  return `${OPTION_PREFIX}${index}`;
}

export interface CardEvent {
  /** Which request the card belongs to; undefined for a card this plugin did not send. */
  readonly kind?: 'approval' | 'question';
  /** Which button was tapped; undefined for a card this plugin did not send. */
  readonly action?: 'approve' | 'deny' | 'option';
  /** For a question card, the 0-based index of the tapped option. */
  readonly option?: number;
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
  const id = typeof taskId === 'string' ? taskId : '';
  const kind = id.startsWith(TASK_PREFIX) ? 'approval' : id.startsWith(QUESTION_PREFIX) ? 'question' : undefined;
  const nonce = id.slice(kind === 'approval' ? TASK_PREFIX.length : kind === 'question' ? QUESTION_PREFIX.length : id.length);
  // A button only means something on the kind of card that carries it.
  let action: CardEvent['action'];
  let option: number | undefined;
  if (kind === 'approval') action = key === APPROVE_BUTTON ? 'approve' : key === DENY_BUTTON ? 'deny' : undefined;
  if (kind === 'question' && typeof key === 'string' && /^opt_\d{1,2}$/.test(key)) {
    action = 'option';
    option = Number(key.slice(OPTION_PREFIX.length));
  }
  return { ...(kind ? { kind } : {}), ...(action ? { action } : {}), ...(option !== undefined ? { option } : {}), nonce, taskId: id, userId, chatId };
}
