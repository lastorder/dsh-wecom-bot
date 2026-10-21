/** Small layout pieces shared by the page sections. */
import { useState } from 'react';
import type { ReactNode, SelectHTMLAttributes } from 'react';
import {
  Button, IconChevronRightOutlineRegular, IconEditOutlineRegular, IconUserOutlineRegular, IconUsersOutlineRegular,
  Input, Modal, StateDot, Tag, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { BindingKind } from '../../shared/protocol.ts';

/** Native select styled with the page's theme tokens. */
export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={['wcb-select', className].filter(Boolean).join(' ')} />;
}

export function Card(props: {
  step?: string | number;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="wcb-card">
      <CardHead {...props} />
      {props.children}
    </section>
  );
}

export function CardHead({ step, title, description, aside }: {
  step?: string | number; title: ReactNode; description?: ReactNode; aside?: ReactNode;
}) {
  return (
    <div className="wcb-card-head">
      {step !== undefined && <span className="wcb-step">{step}</span>}
      <div className="wcb-card-titles">
        <div className="wcb-card-title">{title}</div>
        {description && <div className="wcb-card-desc">{description}</div>}
      </div>
      {aside && <div className="wcb-card-aside">{aside}</div>}
    </div>
  );
}

/**
 * A collapsible section: only its header row is visible until the user opens
 * it. Used for every group card and for the administrator Workspace scope, so
 * the page stays short by default.
 *
 * A section that owns several facts passes them as `facts` instead of a
 * sentence-like `summary`: the facts become a fixed five-track grid with the
 * label above the value, so the Workspace, model, effort and preset of one
 * group line up with the same facts of the next one.
 */
export interface CollapseFact {
  key: string;
  label: ReactNode;
  value: ReactNode;
  title?: string;
}

export function Collapse({ open, onToggle, title, summary, facts, actions, children, className }: {
  open: boolean;
  onToggle(): void;
  title: ReactNode;
  summary?: ReactNode;
  facts?: readonly CollapseFact[];
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const hasFacts = Boolean(facts?.length);
  // The facts are the *collapsed* overview; an open group has its form, which
  // names the same values, so it does not repeat the grid above it.
  const showFacts = hasFacts && !open;
  return (
    <div className={['wcb-group', className].filter(Boolean).join(' ')} data-open={open ? '' : undefined} data-facts={showFacts ? '' : undefined}>
      <div className="wcb-group-head">
        <button type="button" className="wcb-group-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="wcb-group-title-line">
            <span className="wcb-chevron"><IconChevronRightOutlineRegular size={14} /></span>
            <span className="wcb-group-title">{title}</span>
          </span>
          {summary && <span className="wcb-group-summary">{summary}</span>}
          {showFacts && (
            <span className="wcb-group-facts">
              {facts!.map(fact => (
                <span className="wcb-group-fact" key={fact.key}>
                  <span className="wcb-group-fact-label">{fact.label}</span>
                  <span className="wcb-group-fact-value" title={fact.title}>{fact.value}</span>
                </span>
              ))}
            </span>
          )}
        </button>
        {actions && <span className="wcb-group-actions">{actions}</span>}
      </div>
      {open && <div className="wcb-group-body">{children}</div>}
    </div>
  );
}

export function Field({ label, required, hint, error, children }: {
  label: ReactNode; required?: boolean; hint?: ReactNode; error?: string; children: ReactNode;
}) {
  return (
    <div className="wcb-field" data-invalid={error ? '' : undefined}>
      <div className="wcb-field-label">
        {label}
        {required && <span className="wcb-required" aria-label="必填">*</span>}
      </div>
      <div className="wcb-field-control">
        {children}
        {error ? <div className="wcb-field-error" role="alert">{error}</div> : hint && <div className="wcb-hint">{hint}</div>}
      </div>
    </div>
  );
}

export function CheckRow({ checked, onToggle, label, children, meta, disabled }: {
  checked: boolean;
  onToggle(next: boolean): void;
  /** Accessible name of the checkbox. */
  label: string;
  children: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="wcb-row" data-selected={checked ? '' : undefined}>
      <input
        type="checkbox"
        className="wcb-check"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={event => onToggle(event.target.checked)}
      />
      <div className="wcb-row-main">{children}</div>
      {meta && <div className="wcb-row-meta">{meta}</div>}
    </label>
  );
}

/**
 * A private chat and a group chat at a glance: blue person, amber group. Used
 * on its own where the row cannot be opened (a refused sender) and inside
 * {@link PersonAvatar} where it can.
 */
export function KindBadge({ kind, plain }: { kind: BindingKind; plain?: boolean }) {
  return (
    <span className="wcb-avatar" data-kind={kind} data-plain={plain ? '' : undefined} aria-hidden="true">
      {kind === 'group' ? <IconUsersOutlineRegular size={15} /> : <IconUserOutlineRegular size={15} />}
    </span>
  );
}

/**
 * The colored kind badge that is the *only* click target of a person row.
 *
 * The pencil on the corner says that pressing it opens the details — which is
 * also where the 备注 is edited. Nothing else in the row is a button, so the
 * Session line below keeps its own click behavior.
 */
export function PersonAvatar({ kind, label, disabled, onClick }: {
  kind: BindingKind;
  /** Accessible name, e.g. `爱丽丝 的详情`. */
  label: string;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button" className="wcb-avatar" data-kind={kind} data-button=""
      aria-label={label} title="查看详情、编辑备注"
      disabled={disabled} onClick={onClick}
    >
      {kind === 'group' ? <IconUsersOutlineRegular size={15} /> : <IconUserOutlineRegular size={15} />}
      <span className="wcb-avatar-pencil" aria-hidden="true"><IconEditOutlineRegular size={9} /></span>
    </button>
  );
}

/**
 * One person in a list: the badge, the name it is known by, and a right-hand
 * summary. The type is never spelled out here — the badge's color carries it,
 * and the dialog names it in words.
 */
export function PersonRow({ kind, title, meta, label, disabled, onOpen }: {
  kind: BindingKind;
  title: ReactNode;
  /** Right-aligned summary (activity, group, …). */
  meta?: ReactNode;
  label: string;
  disabled?: boolean;
  onOpen(): void;
}) {
  return (
    <div className="wcb-person-head">
      <PersonAvatar kind={kind} label={label} disabled={disabled} onClick={onOpen} />
      <span className="wcb-row-title" title={typeof title === 'string' ? title : undefined}>{title}</span>
      {meta && <span className="wcb-person-meta">{meta}</span>}
    </div>
  );
}

/** One row of the details dialog: a labelled value. */
export function Fact({ name, children, mono }: { name: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="wcb-fact">
      <span className="wcb-fact-key">{name}</span>
      <span className={['wcb-fact-value', mono ? 'wcb-mono' : ''].filter(Boolean).join(' ')}>{children}</span>
    </div>
  );
}

/**
 * One person's details, in a dialog: what kind of principal it is, its WeCom
 * id, and the editable 备注 that replaces the id everywhere else. The note
 * saves on blur — it is Host state, not part of the Config form.
 */
export function PersonDialog({ open, onClose, title, typeLabel, id, label, noteLabel, disabled, onNote, children, footer }: {
  open: boolean;
  onClose(): void;
  /** What the dialog is about (the name the row showed). */
  title: ReactNode;
  typeLabel?: string;
  id: string;
  label: string;
  noteLabel: string;
  disabled?: boolean;
  onNote(next: string): void;
  /** Person-specific extras: the Session it owns, the way out of the group, … */
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal
      open={open} onClose={onClose} title={title} closeLabel="关闭"
      className="wcb-modal" contentClassName="wcb-modal-content"
    >
      <div className="wcb-person-facts">
        {typeLabel && <Fact name="类型">{typeLabel}</Fact>}
        <Fact name="企微 ID" mono>{id}</Fact>
        <div className="wcb-fact">
          <span className="wcb-fact-key">备注</span>
          <Input
            key={label}
            defaultValue={label}
            placeholder={id}
            disabled={disabled}
            aria-label={noteLabel}
            className="wcb-fact-input"
            onBlur={event => {
              const next = event.target.value.trim();
              if (next !== label) onNote(next);
            }}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          />
        </div>
      </div>
      <div className="wcb-hint">备注即时生效，会代替企微 ID 显示；它属于这个人，移出分组后仍然保留。</div>
      {children}
      {footer && <div className="wcb-dialog-actions">{footer}</div>}
    </Modal>
  );
}

/**
 * The bound Session's identity, shown before any navigation.
 *
 * The member table only has room for a compact state, and clicking that state
 * should never jump the page by surprise: the name and the Session ID are read
 * here, and 「在 DSH 中打开」 is the only control that leaves the page.
 */
export function SessionDialog({ open, onClose, name, title, id, running, blank, disabled, error, onOpen }: {
  open: boolean;
  onClose(): void;
  /** The member's display name, so the dialog says whose Session it is. */
  name: string;
  title: string;
  id: string;
  running: boolean;
  /** A created Session whose first turn has not started yet. */
  blank?: boolean;
  disabled?: boolean;
  error?: string;
  onOpen(): void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    if (!await writeClipboard(id)) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Modal
      open={open} onClose={onClose} title={`${name} 的会话`} closeLabel="关闭"
      className="wcb-modal" contentClassName="wcb-modal-content"
    >
      <div className="wcb-person-facts">
        <Fact name="会话名称">{title}</Fact>
        <Fact name="Session ID" mono>{id}</Fact>
        <Fact name="状态">
          <span className="wcb-running">
            <StateDot state={running ? 'ongoing' : 'idle'} size={8} />
            {blank ? '待使用（还没有开始）' : running ? '运行中' : '空闲'}
          </span>
        </Fact>
      </div>
      <div className="wcb-hint">这里只展示会话身份，不会切换页面；点「在 DSH 中打开」才会跳转到这个会话。打开不会改变绑定，也不会新建会话。</div>
      {error && <div className="wcb-field-error" role="alert">{error}</div>}
      <div className="wcb-dialog-actions">
        <Button variant="outline" size="sm" onClick={() => { void copy(); }}>{copied ? '已复制' : '复制 Session ID'}</Button>
        <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
        <Button variant="primary" size="sm" disabled={disabled} onClick={onOpen}>在 DSH 中打开</Button>
      </div>
    </Modal>
  );
}

/**
 * One card's save row: its own fields, its own button. There is no page-wide
 * 保存配置 any more — a section is saved where it is edited, and a successful
 * write needs no lasting banner (the form simply stops being dirty).
 */export function SaveBar({ dirty, saving, saved, error, disabled, onSave, onDiscard }: {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error?: string;
  disabled?: boolean;
  onSave(): void;
  onDiscard(): void;
}) {
  if (!dirty && !saved && !error) return null;
  return (
    <div className="wcb-savebar">
      <span className="wcb-savebar-msg" data-tone={error ? 'error' : saved && !dirty ? 'success' : dirty ? 'dirty' : undefined} role="status">
        {error ?? (saved && !dirty ? '已保存。' : '有未保存的更改')}
      </span>
      <Button variant="ghost" size="sm" disabled={disabled || saving || !dirty} onClick={onDiscard}>放弃</Button>
      <Button variant="primary" size="sm" disabled={disabled || saving || !dirty} onClick={onSave}>
        {saving ? '保存中…' : '保存'}
      </Button>
    </div>
  );
}

/** A confirmation step for a destructive edit that has no form of its own. */
export function ConfirmDialog({ open, title, children, confirmLabel, busy, disabled, onCancel, onConfirm }: {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  disabled?: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} closeLabel="关闭" className="wcb-modal" contentClassName="wcb-modal-content">
      <div className="wcb-confirm-body">{children}</div>
      <div className="wcb-dialog-actions">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>取消</Button>
        <Button variant="primary" size="sm" disabled={busy || disabled} onClick={onConfirm}>
          {busy ? '处理中…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="wcb-empty">{children}</div>;
}

/** `共 N 位成员` style counter used in card headers and group summaries. */
export function CountTag({ count, noun, tone }: { count: number; noun: string; tone?: 'info' | 'quiet' | 'warning' }) {
  return <Tag tone={tone ?? (count ? 'info' : 'quiet')}>{count} {noun}</Tag>;
}
