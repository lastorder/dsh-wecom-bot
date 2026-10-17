import { randomInt } from 'node:crypto';
import type { ApprovalOutcome, Question, QuestionAnswer, QuestionAnswerItem } from '../dsh.js';

/**
 * Pending structured questions and tool approvals answered from WeCom.
 *
 * Each wait is bound to one Session and one fresh, unpredictable short code
 * (the nonce). A reply must quote it, so a delayed or duplicated reply can
 * never claim a later request — even one with the same question id or tool.
 * Every wait resolves to `null` on timeout, abort or shutdown, which makes
 * the caller fall back to the DSH page.
 */

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Short, unambiguous, unpredictable verification code (≈ 30 bits). */
export function verificationCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export interface PendingQuestion {
  readonly sessionId: string;
  readonly questions: readonly Question[];
  readonly nonce: string;
  readonly answers: Map<string, QuestionAnswerItem>;
  finish(value: QuestionAnswer | null): void;
}

export interface PendingApproval {
  readonly sessionId: string;
  readonly toolName: string;
  readonly callId?: string;
  readonly nonce: string;
  /** Only these single chats may answer. */
  readonly privateChats: ReadonlySet<string>;
  finish(value: ApprovalOutcome | null): void;
}

export interface Wait<T> {
  readonly nonce: string;
  readonly result: Promise<T | null>;
}

export interface InteractionRegistry {
  readonly questions: ReadonlyMap<string, PendingQuestion>;
  readonly approvals: ReadonlyMap<string, PendingApproval>;
  /** Undefined when this Session already has a pending question. */
  waitQuestion(sessionId: string, questions: readonly Question[], timeoutMs: number, signal?: AbortSignal): Wait<QuestionAnswer> | undefined;
  /** Undefined when this Session already has a pending approval. */
  waitApproval(
    sessionId: string,
    request: { readonly toolName: string; readonly callId?: string; readonly privateChats: readonly string[] },
    timeoutMs: number,
    signal?: AbortSignal,
  ): Wait<ApprovalOutcome> | undefined;
  findQuestion(nonce: string): PendingQuestion | undefined;
  findApproval(nonce: string): PendingApproval | undefined;
  cancelAll(): void;
}

export function createInteractionRegistry(): InteractionRegistry {
  const questions = new Map<string, PendingQuestion>();
  const approvals = new Map<string, PendingApproval>();

  function open<T, State extends { finish(value: T | null): void }>(
    map: Map<string, State>, sessionId: string, timeoutMs: number, signal: AbortSignal | undefined,
    makeState: (finish: (value: T | null) => void) => State,
  ): Promise<T | null> {
    return new Promise<T | null>(resolve => {
      let done = false;
      const finish = (value: T | null): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (map.get(sessionId) === state) map.delete(sessionId);
        resolve(value);
      };
      const abort = (): void => finish(null);
      const timer = setTimeout(abort, timeoutMs);
      const state = makeState(finish);
      map.set(sessionId, state);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  return {
    questions,
    approvals,
    waitQuestion(sessionId, list, timeoutMs, signal) {
      if (questions.has(sessionId) || signal?.aborted) return undefined;
      const nonce = verificationCode();
      const result = open<QuestionAnswer, PendingQuestion>(questions, sessionId, timeoutMs, signal,
        finish => ({ sessionId, questions: list, nonce, answers: new Map(), finish }));
      return { nonce, result };
    },
    waitApproval(sessionId, request, timeoutMs, signal) {
      if (approvals.has(sessionId) || signal?.aborted) return undefined;
      const nonce = verificationCode();
      const result = open<ApprovalOutcome, PendingApproval>(approvals, sessionId, timeoutMs, signal,
        finish => ({
          sessionId, toolName: request.toolName, nonce, privateChats: new Set(request.privateChats), finish,
          ...(request.callId ? { callId: request.callId } : {}),
        }));
      return { nonce, result };
    },
    findQuestion(nonce) {
      const code = nonce.trim().toLowerCase();
      return code ? [...questions.values()].find(state => state.nonce === code) : undefined;
    },
    findApproval(nonce) {
      const code = nonce.trim().toLowerCase();
      return code ? [...approvals.values()].find(state => state.nonce === code) : undefined;
    },
    cancelAll() {
      for (const state of [...questions.values()]) state.finish(null);
      for (const state of [...approvals.values()]) state.finish(null);
    },
  };
}

export type ParsedAnswer =
  | { readonly ok: true; readonly item: QuestionAnswerItem }
  | { readonly ok: false; readonly error: string };

/** Map `1`, `1,3`, an exact option label, or free text onto one answer item. */
export function parseAnswer(question: Question, raw: string): ParsedAnswer {
  const value = raw.trim();
  if (!value) return { ok: false, error: '答案不能为空' };
  const options = question.options ?? [];
  const indices = value.split(/[,，、\s]+/).filter(Boolean).map(Number);
  let selected: string[] = [];
  if (options.length && indices.length && indices.every(n => Number.isInteger(n) && n >= 1 && n <= options.length)) {
    selected = [...new Set(indices)].map(n => options[n - 1]!.label);
  } else if (options.some(option => option.label === value)) {
    selected = [value];
  }
  if (selected.length > 1 && !question.multiSelect) return { ok: false, error: '这道题只能选择一个选项' };
  return { ok: true, item: { id: question.id, selected, ...(selected.length ? {} : { custom: value }) } };
}
