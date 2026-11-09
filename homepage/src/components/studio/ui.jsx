import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

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
      // Esc closes the open note first, not the dialog around it.
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }
      }}
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

// Several on or off at once, drawn like Segmented (toggle buttons). options
// are [value, text]; value is the array of values that are on. With
// required, the last one on can't be turned off.
export function MultiSegmented({ value = [], onChange, options, label, id, required = false }) {
  return (
    <div role="group" aria-label={label} id={id} className="studio-segmented studio-multi-segmented">
      {options.map(([option, text]) => {
        const on = value.includes(option);
        const last = required && on && value.length === 1;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            aria-disabled={last || undefined}
            title={last ? "At least one stays on" : undefined}
            onClick={() => {
              if (last) return;
              onChange(on ? value.filter((entry) => entry !== option) : [...value, option]);
            }}
          >
            {text}
          </button>
        );
      })}
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

// One section of a dialog that opens one at a time (board 24): its title,
// what it covers, and a summary of what it is set to while closed. The body
// stays mounted while closed, so nothing typed in it is lost.
export function Section({ title, detail, summary, open, onToggle, attention, children, className = "" }) {
  const id = useId();
  const ref = useRef(null);
  const opened = useRef(open);
  useEffect(() => {
    // Opening a section further down brings its start into view.
    if (open && !opened.current) ref.current?.scrollIntoView?.({ block: "nearest" });
    opened.current = open;
  }, [open]);
  return (
    <section ref={ref} className={`studio-section${open ? " studio-section-open" : ""} ${className}`.trim()}>
      <h3 className="studio-section-heading">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <span className="studio-section-text">
            <span className="studio-section-title">{title}</span>
            {detail && <span className="studio-section-detail">{detail}</span>}
          </span>
          {(attention || summary) && (
            <span className={`studio-section-summary${attention ? " studio-section-attention" : ""}`}>
              {attention || summary}
            </span>
          )}
          <StudioIcon name="chevron" size={15} className="studio-section-chevron" />
        </button>
      </h3>
      <div id={id} className="studio-section-body" hidden={!open}>
        {children}
      </div>
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

// Scrolls a form that just opened into view and focuses its first field.
export function revealForm(element) {
  if (!element) return;
  element.scrollIntoView?.({ block: "nearest" });
  element.querySelector("input, textarea, select")?.focus({ preventScroll: true });
}

// A themed dropdown (mock-ups v4: every dropdown in Studio is this list, never
// the white system one). options are [value, text, detail?]. With a
// placeholder and no matching value it is a menu ("+ Add a block").
export function Select({ value, onChange, options, label, id, placeholder, className = "", disabled = false }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const button = useRef(null);
  const listId = useId();
  const chosen = options.find(([option]) => option === value);
  // The list floats (position: fixed) under the button, or above it when
  // there is more room there, and follows it while anything scrolls.
  const [place, setPlace] = useState(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const box = button.current?.getBoundingClientRect();
      if (!box) return;
      const below = window.innerHeight - box.bottom - 8;
      const above = box.top - 8;
      const up = below < 200 && above > below;
      const width = Math.max(box.width, 180);
      setPlace({
        left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
        minWidth: width,
        maxWidth: Math.max(width, Math.min(360, window.innerWidth - 16)),
        maxHeight: Math.max(120, Math.min(320, (up ? above : below) - 4)),
        ...(up ? { bottom: window.innerHeight - box.top + 4 } : { top: box.bottom + 4 }),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  useEffect(() => {
    if (open) root.current?.querySelectorAll('[role="option"]')[active]?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);
  const show = () => {
    setActive(
      Math.max(
        0,
        options.findIndex(([option]) => option === value),
      ),
    );
    setOpen(true);
  };
  const choose = (option) => {
    setOpen(false);
    button.current?.focus();
    if (option !== value || placeholder) onChange(option);
  };
  // Typing letters jumps to the next option that starts with them, as a
  // system list does.
  const typed = useRef({ text: "", at: 0 });
  const typeAhead = (event) => {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.key === " ") return false;
    const now = Date.now();
    const text = (now - typed.current.at < 800 ? typed.current.text : "") + event.key.toLowerCase();
    typed.current = { text, at: now };
    const from = open
      ? active
      : Math.max(
          0,
          options.findIndex(([option]) => option === value),
        );
    const order = options.map((_, index) => (from + (text.length > 1 ? 0 : 1) + index) % options.length);
    const match = order.find((index) => String(options[index][1]).toLowerCase().startsWith(text));
    if (match === undefined) return true;
    if (open) setActive(match);
    else onChange(options[match][0]);
    return true;
  };
  const key = (event) => {
    if (disabled) return;
    if (typeAhead(event)) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
    const last = options.length - 1;
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) {
      event.preventDefault();
      setActive((index) => Math.min(last, Math.max(0, index + step)));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : last);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (options[active]) choose(options[active][0]);
    } else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      setOpen(false);
    }
  };
  return (
    <div ref={root} className={`studio-select ${className}`.trim()}>
      <button
        ref={button}
        id={id}
        type="button"
        className="studio-select-button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={key}
      >
        <span className="studio-select-text">{chosen ? chosen[1] : placeholder}</span>
        <StudioIcon name="chevronDown" size={14} />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="studio-select-list"
          style={place || { visibility: "hidden" }}
        >
          {options.map(([option, text, detail], index) => (
            <li
              key={String(option)}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option === value}
              className={index === active ? "is-active" : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(option)}
            >
              <span>{text}</span>
              {detail && <small>{detail}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
