/** Small layout pieces shared by the page sections. */
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { IconChevronRightOutlineRegular, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives';

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
 */
export function Collapse({ open, onToggle, title, summary, actions, children, className }: {
  open: boolean;
  onToggle(): void;
  title: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={['wcb-group', className].filter(Boolean).join(' ')} data-open={open ? '' : undefined}>
      <div className="wcb-group-head">
        <button type="button" className="wcb-group-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="wcb-chevron"><IconChevronRightOutlineRegular size={14} /></span>
          <span className="wcb-group-title">{title}</span>
          {summary && <span className="wcb-group-summary">{summary}</span>}
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
 * One person row. The header is the only thing visible until it is clicked;
 * clicking reveals the details below (type, WeCom id, editable 备注), which is
 * where every person component — a group's members, the administrator list —
 * edits the note that replaces the id in the row itself.
 */
export function PersonRow({ open, onToggle, icon, kind, title, toggleLabel, meta, actions, children }: {
  open: boolean;
  onToggle(): void;
  icon?: ReactNode;
  /** Accessible name of the row toggle, e.g. `爱丽丝 的详情`. */
  toggleLabel?: string;
  /** Type tag shown before the name. */
  kind?: ReactNode;
  title: ReactNode;
  /** Right-aligned summary in the header (activity, Session state, …). */
  meta?: ReactNode;
  /** Buttons kept outside the toggle, so clicking them never expands the row. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="wcb-person" data-open={open ? '' : undefined}>
      <div className="wcb-person-head">
        <button
          type="button" className="wcb-person-toggle" aria-expanded={open}
          aria-label={toggleLabel} onClick={onToggle}
        >
          {icon && <span className="wcb-binding-icon">{icon}</span>}
          {kind}
          <span className="wcb-row-title" title={typeof title === 'string' ? title : undefined}>{title}</span>
          {meta && <span className="wcb-person-meta">{meta}</span>}
          <span className="wcb-chevron"><IconChevronRightOutlineRegular size={14} /></span>
        </button>
        {actions && <span className="wcb-person-actions">{actions}</span>}
      </div>
      {open && <div className="wcb-person-body">{children}</div>}
    </div>
  );
}

/** Type / WeCom id / 备注 of one person; the note saves when the field blurs. */
export function PersonFacts({ kind, id, label, disabled, noteLabel, onNote }: {
  kind: string;
  id: string;
  label: string;
  disabled?: boolean;
  noteLabel: string;
  onNote(next: string): void;
}) {
  return (
    <div className="wcb-person-facts">
      <div className="wcb-fact">
        <span className="wcb-fact-key">类型</span>
        <span className="wcb-fact-value">{kind}</span>
      </div>
      <div className="wcb-fact">
        <span className="wcb-fact-key">企微 ID</span>
        <span className="wcb-fact-value wcb-mono">{id}</span>
      </div>
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
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="wcb-empty">{children}</div>;
}

/** `共 N 位成员` style counter used in card headers and group summaries. */
export function CountTag({ count, noun, tone }: { count: number; noun: string; tone?: 'info' | 'quiet' | 'warning' }) {
  return <Tag tone={tone ?? (count ? 'info' : 'quiet')}>{count} {noun}</Tag>;
}
