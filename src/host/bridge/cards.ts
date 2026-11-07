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
/** The most options a checkbox card carries. */
export const MAX_CHECKBOX_OPTIONS = 20;
/** The submit button of a checkbox card. */
export const SUBMIT_BUTTON = 'submit';
/** The one checkbox group on a question card. */
export const CHECKBOX_KEY = 'pick';

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
  readonly action?: 'approve' | 'deny' | 'option' | 'submit';
  /** For a question card, the 0-based index of the tapped option. */
  readonly option?: number;
  /**
   * For a checkbox card's submit: the 0-based options ticked. Undefined when the
   * frame carries no selection field at all (as opposed to an empty one), so the
   * caller can tell "nothing ticked" from "cannot read it".
   */
  readonly selected?: readonly number[];
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
    event?: { event_key?: unknown; task_id?: unknown; selected_items?: unknown; template_card_event?: { event_key?: unknown; task_id?: unknown; selected_items?: unknown } };
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
  let selected: number[] | undefined;
  if (kind === 'approval') action = key === APPROVE_BUTTON ? 'approve' : key === DENY_BUTTON ? 'deny' : undefined;
  if (kind === 'question' && typeof key === 'string' && /^opt_\d{1,2}$/.test(key)) {
    action = 'option';
    option = Number(key.slice(OPTION_PREFIX.length));
  }
  if (kind === 'question' && key === SUBMIT_BUTTON) {
    action = 'submit';
    selected = selectedOptions(card.selected_items ?? event.selected_items);
  }
  return { ...(kind ? { kind } : {}), ...(action ? { action } : {}), ...(option !== undefined ? { option } : {}), ...(selected ? { selected } : {}), nonce, taskId: id, userId, chatId };
}

/**
 * The options ticked on a checkbox card, as 0-based indexes.
 *
 * WeCom documents the selection as `selected_items.selected_item[].option_ids.option_id[]`
 * for its card callbacks, but this SDK does not type it, so the shape is read
 * leniently: every `option_id` / `option_ids` list found below `selected_items`
 * counts, and only ids this plugin put on the card (`opt_<n>`) are believed.
 * No `selected_items` at all, or only ids that are not ours, returns undefined —
 * "cannot read", never "empty".
 */
export function selectedOptions(items: unknown): number[] | undefined {
  if (items === undefined || items === null) return undefined;
  const found = new Set<number>();
  let foreign = false;
  // Only strings under an option-id key are options; `question_key` and the
  // like are labels of the frame, not choices.
  const visit = (value: unknown, depth: number, ids: boolean): void => {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (!ids) return;
      const match = /^opt_(\d{1,2})$/.exec(value);
      if (match) found.add(Number(match[1]));
      else if (value.trim()) foreign = true;
      return;
    }
    if (Array.isArray(value)) { for (const entry of value) visit(entry, depth + 1, ids); return; }
    if (typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) visit(entry, depth + 1, ids || key === 'option_id' || key === 'option_ids');
    }
  };
  visit(items, 0, false);
  // Ids that are not ours (and none that are) mean the shape is not what we
  // asked for: that is "cannot read", not "nothing ticked".
  if (!found.size && foreign) return undefined;
  return [...found].sort((a, b) => a - b);
}
