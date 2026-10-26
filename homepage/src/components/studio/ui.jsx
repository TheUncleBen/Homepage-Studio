import { useId, useState } from "react";

import StudioIcon from "./icons";

// Studio's shared form pieces, modelled on iOS grouped lists: a section is a
// rounded group of rows, a row is a label with its control, and anything that
// needs explaining sits behind a small info button instead of on the page.

export function InfoButton({ label, open, onToggle, controls }) {
  return (
    <button
      type="button"
      className="studio-info-button"
      aria-label={`About ${label}`}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <StudioIcon name="info" size={16} />
    </button>
  );
}

function useInfo() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return { open, id, toggle: () => setOpen((value) => !value) };
}

function Callout({ id, children }) {
  return (
    <div id={id} className="studio-info-callout" role="note">
      {children}
    </div>
  );
}

export function Group({ title, info, aside, children, className = "" }) {
  const help = useInfo();
  return (
    <section className={`studio-group ${className}`.trim()}>
      {(title || info || aside) && (
        <header className="studio-group-head">
          {title && <h3>{title}</h3>}
          {info && <InfoButton label={title} open={help.open} onToggle={help.toggle} controls={help.id} />}
          {aside && <span className="studio-group-aside">{aside}</span>}
        </header>
      )}
      {info && help.open && <Callout id={help.id}>{info}</Callout>}
      <div className="studio-group-body">{children}</div>
    </section>
  );
}

// A labelled row. Long controls (lists, editors) stack under the label.
export function Row({ label, htmlFor, info, stacked = false, children, className = "" }) {
  const help = useInfo();
  return (
    <div className={`studio-row${stacked ? " studio-row-stacked" : ""} ${className}`.trim()}>
      <div className="studio-row-main">
        {label && (
          <span className="studio-row-label">
            {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
            {info && <InfoButton label={label} open={help.open} onToggle={help.toggle} controls={help.id} />}
          </span>
        )}
        <div className="studio-row-control">{children}</div>
      </div>
      {info && help.open && <Callout id={help.id}>{info}</Callout>}
    </div>
  );
}

export function Switch({ checked, onChange, label, id, disabled = false, describedBy }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      className="studio-switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  );
}

// One choice from a few, as a segmented control (a radio group). An option
// is [value, text] or [value, text, { disabled, describedBy }].
export function Segmented({ value, onChange, options, label, id, disabled = false }) {
  const index = Math.max(
    0,
    options.findIndex(([option]) => option === value),
  );
  return (
    <div
      role="radiogroup"
      aria-label={label}
      id={id}
      className="studio-segmented"
      onKeyDown={(event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step || disabled) return;
        event.preventDefault();
        let next = index;
        for (let tries = 0; tries < options.length; tries += 1) {
          next = (next + step + options.length) % options.length;
          if (!options[next][2]?.disabled) break;
        }
        if (next === index) return;
        onChange(options[next][0]);
        event.currentTarget.querySelectorAll('[role="radio"]')[next]?.focus();
      }}
    >
      {options.map(([option, text, meta = {}], position) => (
        <button
          key={String(option)}
          type="button"
          role="radio"
          aria-checked={option === value}
          aria-describedby={meta.describedBy}
          tabIndex={position === index ? 0 : -1}
          disabled={disabled || meta.disabled}
          onClick={() => onChange(option)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

// A row that opens more below it, for content most people never need.
export function Disclosure({ title, icon, children, defaultOpen = false, className = "" }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={`studio-disclosure ${className}`.trim()}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        {icon && <StudioIcon name={icon} size={17} />}
        <span>{title}</span>
        <StudioIcon name="chevron" size={15} className="studio-disclosure-chevron" />
      </button>
      {open && (
        <div id={id} className="studio-disclosure-body">
          {children}
        </div>
      )}
    </section>
  );
}

// A tappable row inside a group: Duplicate, Delete, Edit the service, ….
export function ActionRow({ icon, children, danger = false, detail, ...props }) {
  return (
    <button type="button" className={`studio-action-row${danger ? " studio-action-danger" : ""}`} {...props}>
      {icon && <StudioIcon name={icon} size={17} />}
      <span className="studio-action-label">{children}</span>
      {detail && <span className="studio-action-detail">{detail}</span>}
      {!danger && <StudioIcon name="chevron" size={15} className="studio-action-chevron" />}
    </button>
  );
}
