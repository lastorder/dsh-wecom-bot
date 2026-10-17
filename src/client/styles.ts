/**
 * Page stylesheet. Colors come from DSH `--dsw-*` theme tokens (with
 * fallbacks), so the page follows light/dark mode like native settings.
 * Every class is prefixed `wcb-` to stay out of the host's namespace.
 */
export const STYLES = /* css */ `
/* The person dialog is portalled to document.body, outside .wcb-page, so the
   token set is declared once for both roots. */
.wcb-page, .wcb-modal {
  /* DSH is monochrome; the business blue is its accent for focus and info. */
  --wcb-brand: var(--dsw-alias-state-business-primary, #4176e6);
  --wcb-text: var(--dsw-alias-label-primary, #0f1115);
  --wcb-text-2: var(--dsw-alias-label-secondary, #61666b);
  --wcb-text-3: var(--dsw-alias-label-tertiary, #81858c);
  --wcb-surface: var(--dsw-alias-bg-layer-1, #fff);
  --wcb-surface-2: var(--dsw-alias-bg-module-platform, #f5f6f7);
  --wcb-line: var(--dsw-alias-border-l2, rgba(0,0,0,.1));
  --wcb-line-2: var(--dsw-alias-border-l3, rgba(0,0,0,.12));
  --wcb-ok: var(--dsw-alias-state-success-primary, #1a7f37);
  --wcb-warn: var(--dsw-alias-state-warn-primary, #bf8700);
  --wcb-err: var(--dsw-alias-state-error-primary, #cf222e);
  --wcb-hover: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08));
  --wcb-mono: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 960px;
  margin: 0 auto;
  padding: 4px 0 24px;
  color: var(--wcb-text);
  font-size: 14px;
  line-height: 1.5;
}
.wcb-page *, .wcb-page *::before, .wcb-page *::after,
.wcb-modal *, .wcb-modal *::before, .wcb-modal *::after { box-sizing: border-box; }

/* Hero */
.wcb-hero {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 20px 22px; border-radius: 16px;
  border: .5px solid var(--wcb-line);
  background:
    radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--wcb-brand) 14%, transparent), transparent 60%),
    var(--wcb-surface);
}
.wcb-hero-mark {
  flex: none; width: 46px; height: 46px; border-radius: 14px;
  display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 18px;
  background: linear-gradient(135deg, #2f9bff, #2a6df4);
  box-shadow: 0 6px 18px color-mix(in srgb, #2a6df4 35%, transparent);
}
.wcb-hero-text { flex: 1; min-width: 220px; }
.wcb-hero-title { font-size: 18px; font-weight: 650; letter-spacing: .2px; }
.wcb-hero-sub { color: var(--wcb-text-2); font-size: 13px; margin-top: 2px; }
.wcb-hero-status { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.wcb-pill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 4px 12px; border-radius: 999px; font-size: 13px; font-weight: 550;
  background: var(--wcb-surface-2); border: .5px solid var(--wcb-line);
}
.wcb-pill[data-tone="ok"] { color: var(--wcb-ok); background: color-mix(in srgb, var(--wcb-ok) 10%, transparent); }
.wcb-pill[data-tone="warn"] { color: var(--wcb-warn); background: color-mix(in srgb, var(--wcb-warn) 12%, transparent); }
.wcb-pill[data-tone="err"] { color: var(--wcb-err); background: color-mix(in srgb, var(--wcb-err) 10%, transparent); }
.wcb-status-detail { color: var(--wcb-text-3); font-size: 12px; max-width: 320px; text-align: right; }
.wcb-stats {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px;
  width: 100%; margin-top: 4px; border-radius: 12px; overflow: hidden;
  background: var(--wcb-line); border: .5px solid var(--wcb-line);
}
.wcb-stat { background: var(--wcb-surface); padding: 10px 14px; }
.wcb-stat-value { font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; }
.wcb-stat-label { color: var(--wcb-text-3); font-size: 12px; }

/* Banner */
.wcb-banner {
  display: flex; gap: 12px; align-items: flex-start;
  padding: 14px 16px; border-radius: 14px; border: .5px solid var(--wcb-line);
}
.wcb-banner[data-tone="danger"] { border-color: color-mix(in srgb, var(--wcb-err) 40%, transparent); background: color-mix(in srgb, var(--wcb-err) 7%, var(--wcb-surface)); }
.wcb-banner[data-tone="warning"] { border-color: color-mix(in srgb, var(--wcb-warn) 40%, transparent); background: color-mix(in srgb, var(--wcb-warn) 8%, var(--wcb-surface)); }
.wcb-banner[data-tone="success"] { border-color: color-mix(in srgb, var(--wcb-ok) 35%, transparent); background: color-mix(in srgb, var(--wcb-ok) 6%, var(--wcb-surface)); }
.wcb-banner-icon { flex: none; margin-top: 2px; }
.wcb-banner[data-tone="danger"] .wcb-banner-icon { color: var(--wcb-err); }
.wcb-banner[data-tone="warning"] .wcb-banner-icon { color: var(--wcb-warn); }
.wcb-banner[data-tone="success"] .wcb-banner-icon { color: var(--wcb-ok); }
.wcb-banner-title { font-weight: 650; }
.wcb-banner-body { color: var(--wcb-text-2); font-size: 13px; margin-top: 4px; }
.wcb-banner-body ol, .wcb-banner-body ul { margin: 6px 0 0; padding-left: 20px; }
.wcb-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }

/* Cards */
.wcb-card {
  background: var(--wcb-surface); border: .5px solid var(--wcb-line);
  border-radius: 16px; padding: 18px 20px;
}
.wcb-card-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.wcb-step {
  flex: none; width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center; font-size: 12px; font-weight: 700;
  color: var(--wcb-brand); background: color-mix(in srgb, var(--wcb-brand) 13%, transparent);
}
.wcb-card-titles { flex: 1; min-width: 0; }
.wcb-card-title { font-size: 15px; font-weight: 650; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wcb-card-desc { color: var(--wcb-text-2); font-size: 12.5px; margin-top: 2px; }
.wcb-card-aside { flex: none; display: flex; gap: 6px; align-items: center; }

/* Fields */
.wcb-field {
  display: grid; grid-template-columns: 168px minmax(0, 1fr); gap: 4px 18px;
  padding: 12px 0; border-top: .5px solid var(--wcb-line);
}
.wcb-field:first-child { border-top: none; padding-top: 2px; }
.wcb-field-label { font-weight: 550; padding-top: 6px; }
.wcb-required { color: var(--wcb-err); margin-left: 2px; }
.wcb-field-control { min-width: 0; }
.wcb-field-row { display: flex; gap: 8px; align-items: center; }
.wcb-grow { flex: 1; min-width: 0; width: 100%; }
.wcb-hint { color: var(--wcb-text-3); font-size: 12px; margin-top: 6px; }
.wcb-field-error { color: var(--wcb-err); font-size: 12px; margin-top: 6px; }
.wcb-field[data-invalid] .wcb-grow { border-color: var(--wcb-err); }
.wcb-number { width: 120px; }
@media (max-width: 720px) {
  .wcb-field { grid-template-columns: 1fr; }
  .wcb-field-label { padding-top: 0; }
  .wcb-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* Lists */
.wcb-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.wcb-toolbar .wcb-search { flex: 1; min-width: 220px; }
.wcb-scroll { max-height: 460px; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding: 1px; }
/* The group list grows with the page: nested scroll boxes inside another
   scroll box are what make a settings page impossible to scan. */
.wcb-groups { display: flex; flex-direction: column; gap: 8px; padding: 1px; }
.wcb-group { border: .5px solid var(--wcb-line); border-radius: 12px; overflow: hidden; background: var(--wcb-surface); }
.wcb-group-head {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 0 12px 0 0; background: var(--wcb-surface-2);
}
.wcb-group-toggle {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; background: none; border: none; color: inherit;
  font: inherit; text-align: left; cursor: pointer;
}
.wcb-group-toggle:hover { box-shadow: inset 0 0 0 999px var(--wcb-hover); }
.wcb-group-actions { flex: none; display: flex; gap: 6px; align-items: center; }
.wcb-group-body { border-top: .5px solid var(--wcb-line); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.wcb-chevron { flex: none; color: var(--wcb-text-3); transition: transform .15s ease; }
.wcb-group[data-open] .wcb-chevron { transform: rotate(90deg); }
.wcb-group-icon { flex: none; color: var(--wcb-text-2); }
.wcb-group-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }
.wcb-group-summary { flex: 1; min-width: 0; color: var(--wcb-text-3); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right; }
.wcb-row {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 12px; border-top: .5px solid var(--wcb-line); cursor: pointer;
}
.wcb-row:hover { background: var(--wcb-hover); }
.wcb-row[data-selected] { background: color-mix(in srgb, var(--wcb-brand) 7%, transparent); }
.wcb-check { flex: none; width: 16px; height: 16px; margin: 0; accent-color: var(--wcb-brand); cursor: pointer; }
.wcb-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wcb-row-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.wcb-row-title[data-muted] { color: var(--wcb-text-3); font-weight: 400; font-style: italic; }
.wcb-row-sub { display: flex; gap: 8px; align-items: center; color: var(--wcb-text-3); font-size: 12px; min-width: 0; }
.wcb-mono { font-family: var(--wcb-mono); font-size: 11.5px; }
.wcb-ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.wcb-row-meta { flex: none; display: flex; gap: 6px; align-items: center; color: var(--wcb-text-3); font-size: 12px; }
.wcb-running { display: inline-flex; align-items: center; gap: 4px; color: var(--wcb-text-2); }
.wcb-pin { color: var(--wcb-brand); display: inline-flex; }
.wcb-list-foot { color: var(--wcb-text-3); font-size: 12px; margin-top: 10px; display: flex; gap: 12px; flex-wrap: wrap; }
.wcb-empty {
  padding: 22px 18px; border-radius: 12px; text-align: center;
  border: 1px dashed var(--wcb-line-2); color: var(--wcb-text-2); font-size: 13px;
}
.wcb-empty ol { display: inline-block; text-align: left; margin: 8px 0 0; padding-left: 20px; color: var(--wcb-text-3); }
.wcb-hidden-list { margin-top: 12px; border: .5px dashed color-mix(in srgb, var(--wcb-warn) 50%, transparent); border-radius: 12px; padding: 4px 0; }
.wcb-hidden-head { padding: 6px 12px; font-size: 12.5px; color: var(--wcb-warn); font-weight: 600; display: flex; align-items: center; gap: 8px; }

/* Identities */
.wcb-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
@media (max-width: 820px) { .wcb-columns { grid-template-columns: 1fr; } }
.wcb-subhead { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.wcb-subhead-title { font-weight: 600; }
.wcb-subhead-hint { color: var(--wcb-text-3); font-size: 12px; }
.wcb-subhead .wcb-card-aside { margin-left: auto; }
.wcb-panel { border: .5px solid var(--wcb-line); border-radius: 12px; overflow: hidden; }
.wcb-panel .wcb-row:first-child { border-top: none; }
.wcb-panel-scroll { max-height: 320px; overflow: auto; }
.wcb-add { display: flex; gap: 8px; padding: 10px 12px; border-top: .5px solid var(--wcb-line); background: var(--wcb-surface-2); }

/* Advanced */
.wcb-details > summary { list-style: none; cursor: pointer; }
.wcb-details > summary::-webkit-details-marker { display: none; }
.wcb-details > summary .wcb-card-head { margin-bottom: 0; }
.wcb-details[open] > summary .wcb-card-head { margin-bottom: 14px; }
.wcb-details[open] > summary .wcb-chevron { transform: rotate(90deg); }
.wcb-path {
  font-family: var(--wcb-mono); font-size: 12px; padding: 7px 10px; border-radius: 8px;
  background: var(--wcb-surface-2); border: .5px solid var(--wcb-line); word-break: break-all;
}
.wcb-code { font-family: var(--wcb-mono); font-size: 12px; background: var(--wcb-surface-2); padding: 1px 5px; border-radius: 5px; }

/* Footer */
.wcb-footer {
  position: sticky; bottom: 12px; z-index: 2;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 12px 14px 12px 18px; border-radius: 16px;
  background: color-mix(in srgb, var(--wcb-surface) 88%, transparent);
  border: .5px solid var(--wcb-line-2);
  box-shadow: 0 10px 30px rgba(0, 0, 0, .12);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.wcb-footer-msg { flex: 1; min-width: 200px; display: flex; align-items: center; gap: 8px; color: var(--wcb-text-2); font-size: 13px; }
.wcb-footer-msg[data-tone="error"] { color: var(--wcb-err); }
.wcb-footer-msg[data-tone="success"] { color: var(--wcb-ok); }
.wcb-footer-msg[data-tone="dirty"] { color: var(--wcb-warn); }

/* Selects and inline text */
.wcb-select {
  min-width: 0; max-width: 100%; height: 32px; padding: 0 8px;
  border: .5px solid var(--wcb-line-2); border-radius: 8px;
  background: var(--wcb-surface); color: var(--wcb-text); font: inherit; font-size: 13px;
  cursor: pointer; appearance: auto;
}
.wcb-select:disabled { opacity: .55; cursor: not-allowed; }
.wcb-muted { color: var(--wcb-text-3); }
.wcb-inline-error { color: var(--wcb-err); }
.wcb-link {
  border: none; background: none; padding: 0; cursor: pointer;
  color: var(--wcb-brand); font: inherit; font-size: 12px; text-decoration: underline;
}
.wcb-link:disabled { color: var(--wcb-text-3); cursor: not-allowed; text-decoration: none; }
.wcb-banner-foot { margin-top: 6px; color: var(--wcb-text-3); font-size: 12px; }
.wcb-row-meta-inner { display: inline-flex; align-items: center; gap: 6px; }

/* Groups and members */
/* Name, Workspace, model, effort, preset: the model needs the most room. */
.wcb-binding-controls {
  display: grid; gap: 8px;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr) minmax(0, 1.6fr) minmax(0, .8fr) minmax(0, 1.25fr);
}
@media (max-width: 900px) {
  .wcb-binding-controls { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
}
.wcb-binding-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.wcb-binding-label { color: var(--wcb-text-3); font-size: 11.5px; }
.wcb-members { display: flex; flex-direction: column; gap: 4px; padding: 4px; border: .5px solid var(--wcb-line); border-radius: 10px; }
.wcb-member { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border-radius: 8px; }
.wcb-member + .wcb-member { border-top: .5px solid var(--wcb-line); border-top-left-radius: 0; border-top-right-radius: 0; }
.wcb-member-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* A person line: the colored badge is the only thing that opens the details. */
.wcb-person-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wcb-person-meta { flex: none; display: flex; align-items: center; gap: 6px; color: var(--wcb-text-3); font-size: 12px; margin-left: auto; }
.wcb-avatar {
  flex: none; position: relative; display: grid; place-items: center;
  width: 26px; height: 26px; padding: 0; border-radius: 50%;
  border: .5px solid transparent;
}
.wcb-avatar[data-kind="user"] { color: #2a6df4; background: color-mix(in srgb, #2a6df4 12%, transparent); }
.wcb-avatar[data-kind="group"] { color: #b06f00; background: color-mix(in srgb, #bf8700 18%, transparent); }
.wcb-avatar[data-button] { cursor: pointer; transition: transform .12s ease, box-shadow .12s ease; }
.wcb-avatar[data-button]:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--wcb-text) 22%, transparent);
}
.wcb-avatar[data-button]:active:not(:disabled) { transform: none; }
.wcb-avatar[data-button]:focus-visible { outline: 2px solid var(--wcb-brand); outline-offset: 2px; }
.wcb-avatar[data-button]:disabled { cursor: not-allowed; opacity: .5; }
/* The pencil badge: "pressing this opens the details form". */
.wcb-avatar-pencil {
  position: absolute; right: -3px; bottom: -3px;
  width: 13px; height: 13px; border-radius: 50%;
  display: grid; place-items: center;
  color: var(--wcb-text-2); background: var(--wcb-surface);
  border: .5px solid var(--wcb-line-2);
}

/* The session line a member owns: four read-only facts until it is clicked. */
.wcb-session-block { display: flex; flex-direction: column; gap: 4px; margin-left: 34px; }
.wcb-session {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px;
  width: 100%; padding: 5px 10px; border-radius: 8px; cursor: pointer;
  border: .5px solid transparent; background: var(--wcb-surface-2);
  color: inherit; font: inherit; text-align: left;
}
.wcb-session:hover:not(:disabled) { border-color: var(--wcb-line-2); }
.wcb-session[data-open] { border-color: color-mix(in srgb, var(--wcb-brand) 45%, transparent); background: var(--wcb-surface); }
.wcb-session:focus-visible { outline: 2px solid var(--wcb-brand); outline-offset: 1px; }
.wcb-session:disabled { cursor: not-allowed; opacity: .7; }
.wcb-session-fact { display: inline-flex; align-items: center; gap: 5px; min-width: 0; color: var(--wcb-text-2); font-size: 12px; }
.wcb-session-key { color: var(--wcb-text-3); font-size: 11px; }
.wcb-session-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; color: var(--wcb-text); }
.wcb-session-icon { color: var(--wcb-icon-preset, var(--wcb-text-3)); }
.wcb-session-hint { grid-column: 1 / -1; margin-top: 0; }
.wcb-member-edit {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px;
  align-items: end; padding: 8px 10px; border-radius: 8px; background: var(--wcb-surface-2);
}
@media (max-width: 820px) { .wcb-member-edit { grid-template-columns: 1fr; } }
.wcb-member-actions { display: flex; gap: 6px; align-items: center; justify-content: flex-end; }

/* The person dialog (portalled, so it re-declares the page tokens). */
.wcb-modal { padding: 0; }
.wcb-modal-content { display: flex; flex-direction: column; gap: 14px; }
.wcb-person-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px 18px; }
.wcb-person-facts + .wcb-hint { margin-top: 0; }
/* The session block sits under the identity facts, behind a hairline. */
.wcb-dialog-section { border-top: .5px solid var(--wcb-line); padding-top: 14px; }
.wcb-dialog-section .wcb-binding-field { margin-top: 12px; }
.wcb-fact { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.wcb-fact-key { color: var(--wcb-text-3); font-size: 11.5px; }
.wcb-fact-value { min-width: 0; overflow-wrap: anywhere; }
.wcb-fact-input { width: 100%; }
.wcb-dialog-actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
.wcb-rejected-text {
  color: var(--wcb-text-2); font-size: 12.5px; padding: 6px 10px; border-radius: 8px;
  background: var(--wcb-surface-2); border-left: 2px solid var(--wcb-line-2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
`;

export function insertStyles(doc: Document = document): () => void {
  const element = doc.createElement('style');
  element.setAttribute('data-dsh-plugin', 'wecom-bot');
  element.textContent = STYLES;
  doc.head.appendChild(element);
  return () => element.remove();
}
