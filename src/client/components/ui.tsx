/** Small layout pieces shared by the page sections. */
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives';

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

/** "全部允许" when the allowlist is empty, otherwise the selection count. */
export function ScopeTag({ count }: { count: number }) {
  return count ? <Tag tone="info">已选 {count}</Tag> : <Tag tone="warning">未限制 · 全部允许</Tag>;
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

export function Empty({ children }: { children: ReactNode }) {
  return <div className="wcb-empty">{children}</div>;
}
