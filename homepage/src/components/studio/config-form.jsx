import { dump, load } from "js-yaml";
import { useTranslation } from "next-i18next/pages";
import { useEffect, useId, useState } from "react";

import { CONNECTION_FIELDS, ConnectionChooser, ConnectionSave, ConnectionTest, savedConnectionId } from "./connections";
import Guide from "./guide";
import { IconField } from "./icon-chooser";
import StudioIcon from "./icons";
import { isObject } from "./native-adapter.mjs";
import { Disclosure, Group, Row, Segmented, Switch } from "./ui";

export const LINK_FIELDS = [
  { key: "href", label: "Destination URL", type: "string" },
  { key: "description", label: "Description", type: "string" },
  { key: "icon", label: "Icon", type: "string", icon: true },
  {
    key: "target",
    label: "Open target",
    type: "string",
    exampleValue: "_blank",
  },
];
export const SERVICE_FIELDS = [
  ...LINK_FIELDS,
  { key: "ping", label: "Ping hostname", type: "string" },
  { key: "siteMonitor", label: "Site monitor URL", type: "string" },
  { key: "server", label: "Docker server", type: "string" },
  { key: "container", label: "Docker container", type: "string" },
  { key: "showStats", label: "Show native statistics", type: "boolean" },
];
export const SETTINGS_FIELDS = [
  { key: "title", label: "Dashboard title", type: "string" },
  { key: "description", label: "Description", type: "string", exampleValue: "A line under the title" },
  { key: "language", label: "Language", type: "string", exampleValue: "en" },
  {
    key: "target",
    label: "Default link target",
    type: "string",
    exampleValue: "_blank",
  },
  { key: "theme", label: "Native theme", type: "string", exampleValue: "dark" },
  {
    key: "providers",
    label: "Native providers",
    type: "object",
    sensitive: true,
  },
  {
    key: "statusStyle",
    label: "Native status style",
    type: "string",
    exampleValue: "dot",
  },
];

const encode = (value) =>
  value === undefined ? "" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);

// js-yaml messages append an excerpt of the source, which can include inline
// credentials. Show only the reason and the one-based position.
export function yamlErrorMessage(err) {
  if (err?.name === "YAMLException" && err.mark)
    return `Invalid YAML at line ${err.mark.line + 1}, column ${err.mark.column + 1}: ${err.reason}.`;
  return err?.message || String(err);
}

function assertSerializableValue(value) {
  try {
    JSON.stringify(value, (_key, entry) => {
      if (typeof entry === "number" && !Number.isFinite(entry))
        throw new RangeError(
          "This item contains a non-finite number and cannot be saved. Your draft is retained; use a finite number before saving.",
        );
      return entry;
    });
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    throw new Error(
      "This item contains cyclic values and cannot be saved. Your draft is retained; remove the cyclic alias before saving.",
    );
  }
}

// Native option names as words: loginsLast24H → "Logins last 24H".
export function humanize(name) {
  const words = String(name)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .map((word, index) =>
      /[A-Z].*[A-Z0-9]|^[A-Z0-9]+$/.test(word) && word.length > 1
        ? word
        : index
          ? word.toLowerCase()
          : word.charAt(0).toUpperCase() + word.slice(1),
    );
  return words.join(" ");
}

const TYPE_NAMES = { string: "Text", number: "Number", boolean: "On/Off", array: "List", object: "Settings" };
const scalar = (entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry);

function Field({ field, value, onChange, onError }) {
  const actualType = value === undefined ? field.type : Array.isArray(value) ? "array" : typeof value;
  const [kind, setKind] = useState(actualType === "null" ? field.type : actualType);
  const [text, setText] = useState(encode(value));
  const [error, setError] = useState("");
  const [reveal, setReveal] = useState(false);
  // Simple lists and name/value settings get their own editors; anything
  // nested stays a JSON value. The editor is chosen when a value arrives,
  // never while someone types into it.
  const shapeOf = (type, entry) =>
    type === "object" && (entry === undefined || (isObject(entry) && Object.values(entry).every(scalar)))
      ? "pairs"
      : type === "array" && (entry === undefined || (Array.isArray(entry) && entry.every(scalar)))
        ? "list"
        : type === "object" || type === "array"
          ? "json"
          : "plain";
  const [shape, setShape] = useState(() => shapeOf(actualType === "null" ? field.type : actualType, value));
  const [previousValue, setPreviousValue] = useState(value);
  if (!Object.is(previousValue, value)) {
    setPreviousValue(value);
    setText(encode(value));
    const nextKind = value === undefined ? kind : Array.isArray(value) ? "array" : typeof value;
    setKind(nextKind);
    setShape(shapeOf(nextKind, value));
  }
  const update = (next, newKind = kind) => {
    setText(next);
    let parsed;
    let message = "";
    try {
      if (!next) parsed = undefined;
      else if (newKind === "number") {
        parsed = Number(next);
        if (!Number.isFinite(parsed)) throw new Error("Use a valid number.");
      } else if (newKind === "boolean") parsed = next === "true";
      else if (newKind === "array" || newKind === "object") {
        parsed = JSON.parse(next);
        if (newKind === "array" ? !Array.isArray(parsed) : !isObject(parsed)) throw new Error(`Use a JSON ${newKind}.`);
        assertSerializableValue(parsed);
      } else parsed = next;
    } catch (err) {
      message = err.message;
    }
    setError(message);
    onError(field.key, message);
    if (!message) {
      setPreviousValue(parsed);
      onChange(field.key, parsed);
    }
  };
  const id = `studio-field-${field.key}`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : undefined;
  const label = field.label || humanize(field.key);
  const flatObject = shape === "pairs";
  const flatList = shape === "list";
  const structured = shape === "json";
  const placeholder =
    kind === "string" && typeof field.exampleValue === "string" && !field.sensitive ? field.exampleValue : "";
  // A field with documented choices, such as which release of the app a
  // widget talks to. Leaving it out means the first, default choice.
  const choiceList = ["number", "string"].includes(kind) && field.choiceLabels && field.choices?.length;
  const fallback = choiceList ? String(field.defaultChoice ?? field.choices[0]) : "";
  const choiceOptions = choiceList
    ? [
        ...field.choices.map((choice) => [String(choice), field.choiceLabels[String(choice)] ?? String(choice)]),
        ...(text && !field.choices.map(String).includes(text)
          ? [[text, kind === "number" ? `Version ${text}` : text]]
          : []),
      ]
    : [];
  const dateTime =
    field.editor === "dateTimeFormat" &&
    kind === "object" &&
    (value === undefined || (isObject(value) && Object.keys(value).every((key) => DATE_TIME_KEYS.includes(key))));
  let control;
  if (choiceList && choiceOptions.length > 4)
    control = (
      <select
        id={id}
        value={text || fallback}
        onChange={(event) => update(event.target.value === fallback ? "" : event.target.value)}
      >
        {choiceOptions.map(([option, name]) => (
          <option key={option} value={option}>
            {name}
          </option>
        ))}
      </select>
    );
  else if (choiceList)
    control = (
      <Segmented
        id={id}
        label={label}
        value={text || fallback}
        onChange={(next) => update(next === fallback ? "" : next)}
        options={choiceOptions}
      />
    );
  else if (kind === "boolean")
    control = (
      <Segmented
        id={id}
        label={label}
        value={text}
        onChange={(next) => update(next)}
        options={[
          ["", "Default"],
          ["true", "On"],
          ["false", "Off"],
        ]}
      />
    );
  else if (field.icon && kind === "string")
    control = <IconField id={id} label={label} value={text} onChange={(next) => update(next)} />;
  else if (flatObject)
    control = (
      <PairsEditor
        label={label}
        sensitive={field.sensitive}
        value={value}
        onChange={(next) => update(next === undefined ? "" : JSON.stringify(next))}
      />
    );
  else if (flatList)
    control = (
      <ListEditor
        label={label}
        value={value}
        onChange={(next) => update(next === undefined ? "" : JSON.stringify(next))}
      />
    );
  else if (structured)
    control = (
      <textarea
        id={id}
        className="studio-json-input"
        value={text}
        onChange={(event) => update(event.target.value)}
        rows={4}
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      />
    );
  else
    control = (
      <div className="studio-input-line">
        <input
          id={id}
          value={text}
          onChange={(event) => update(event.target.value)}
          type={field.sensitive && !reveal ? "password" : "text"}
          inputMode={kind === "number" ? "decimal" : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
        {field.sensitive && (
          <button
            type="button"
            className="studio-reveal"
            aria-label={reveal ? `Hide ${label}` : `Show ${label}`}
            aria-pressed={reveal}
            onClick={() => setReveal(!reveal)}
          >
            <StudioIcon name={reveal ? "eyeOff" : "eye"} size={17} />
          </button>
        )}
      </div>
    );
  if (dateTime)
    return (
      <DateTimeFormat
        id={id}
        value={value}
        info={field.description}
        onChange={(next) => update(next === undefined ? "" : JSON.stringify(next))}
      />
    );
  return (
    <Row
      label={label}
      htmlFor={
        (choiceList && choiceOptions.length <= 4) || kind === "boolean" || flatObject || flatList || field.icon
          ? undefined
          : id
      }
      info={field.description}
      stacked={
        (choiceList && choiceOptions.length <= 4) ||
        structured ||
        flatObject ||
        flatList ||
        field.icon ||
        field.valueTypes?.length > 1
      }
      className={error ? "studio-row-invalid" : ""}
    >
      {field.valueTypes?.length > 1 && (
        <Segmented
          label={`${label} value type`}
          value={kind}
          onChange={(next) => {
            setKind(next);
            setShape(shapeOf(next, undefined));
            update("", next);
          }}
          options={field.valueTypes.map((type) => [type, TYPE_NAMES[type] || type])}
        />
      )}
      {control}
      {error && (
        <small id={errorId} className="studio-field-error">
          {error}
        </small>
      )}
    </Row>
  );
}

// Date & Time's format as two choices: how the time and the date are written,
// each with an example of today. Any other Intl option keeps the YAML or the
// name/value editor, so nothing set there is lost.
const DATE_TIME_KEYS = ["timeStyle", "dateStyle", "hour12", "hourCycle", "timeZone"];
const STYLES = [
  ["short", "Short"],
  ["medium", "Medium"],
  ["long", "Long"],
  ["full", "Full"],
];
function DateTimeFormat({ id, value, info, onChange }) {
  // Examples in the dashboard's language, as the card writes them.
  const { i18n } = useTranslation();
  const now = new Date();
  const example = (options) => {
    try {
      return new Intl.DateTimeFormat(i18n?.language || undefined, { ...options, timeZone: value?.timeZone }).format(
        now,
      );
    } catch {
      return "";
    }
  };
  const time = value?.timeStyle ?? "";
  const set = (key, next) => {
    const result = { ...(value || {}) };
    if (next) result[key] = next;
    else delete result[key];
    onChange(Object.keys(result).length ? result : undefined);
  };
  const row = (key, label, none, help) => (
    <Row label={label} htmlFor={`${id}-${key}`} info={help}>
      <select id={`${id}-${key}`} value={value?.[key] ?? ""} onChange={(event) => set(key, event.target.value)}>
        <option value="">{none}</option>
        {STYLES.map(([style, name]) => (
          <option key={style} value={style}>
            {`${name} · ${example({ [key]: style })}`}
          </option>
        ))}
      </select>
    </Row>
  );
  return (
    <>
      {row("timeStyle", "Time", "Off", info)}
      {/* With the time off and no date style, the widget writes the date in numbers. */}
      {row("dateStyle", "Date", time ? "Off" : `Numbers · ${example({})}`)}
    </>
  );
}

// Name/value pairs, such as request headers.
function PairsEditor({ label, value, onChange, sensitive = false }) {
  const [rows, setRows] = useState(() => Object.entries(value || {}).map(([name, entry]) => [name, encode(entry)]));
  const [previous, setPrevious] = useState(value);
  if (previous !== value && JSON.stringify(previous) !== JSON.stringify(value)) {
    setPrevious(value);
    setRows(Object.entries(value || {}).map(([name, entry]) => [name, encode(entry)]));
  }
  const commit = (next) => {
    setRows(next);
    const named = next.filter(([name]) => name.trim());
    const object = Object.fromEntries(named.map(([name, entry]) => [name.trim(), entry]));
    setPrevious(named.length ? object : undefined);
    onChange(named.length ? object : undefined);
  };
  return (
    <div className="studio-pairs" role="group" aria-label={label}>
      {rows.map(([name, entry], index) => (
        <div className="studio-pair" key={index}>
          <input
            aria-label={`${label} ${index + 1} name`}
            placeholder="Name"
            value={name}
            spellCheck={false}
            onChange={(event) => commit(rows.map((row, at) => (at === index ? [event.target.value, row[1]] : row)))}
          />
          <input
            aria-label={`${label} ${index + 1} value`}
            placeholder="Value"
            type={sensitive ? "password" : "text"}
            value={entry}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => commit(rows.map((row, at) => (at === index ? [row[0], event.target.value] : row)))}
          />
          <button
            type="button"
            className="studio-row-remove"
            aria-label={`Remove ${name || `${label} ${index + 1}`}`}
            onClick={() => commit(rows.filter((_, at) => at !== index))}
          >
            <StudioIcon name="close" size={15} />
          </button>
        </div>
      ))}
      <button type="button" className="studio-row-add" onClick={() => setRows([...rows, ["", ""]])}>
        <StudioIcon name="plus" size={15} />
        Add
      </button>
    </div>
  );
}

// A simple list of values, such as mount paths.
function ListEditor({ label, value, onChange }) {
  const [rows, setRows] = useState(() => (value || []).map(encode));
  const [previous, setPrevious] = useState(value);
  if (previous !== value && JSON.stringify(previous) !== JSON.stringify(value)) {
    setPrevious(value);
    setRows((value || []).map(encode));
  }
  // A list of numbers stays a list of numbers; anything else is text.
  const numeric = Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "number");
  const commit = (next) => {
    setRows(next);
    const list = next
      .filter((entry) => entry.trim())
      .map((entry) => (numeric && Number.isFinite(Number(entry)) ? Number(entry) : entry));
    setPrevious(list.length ? list : undefined);
    onChange(list.length ? list : undefined);
  };
  return (
    <div className="studio-pairs" role="group" aria-label={label}>
      {rows.map((entry, index) => (
        <div className="studio-pair studio-pair-single" key={index}>
          <input
            aria-label={`${label} ${index + 1}`}
            value={entry}
            spellCheck={false}
            onChange={(event) => commit(rows.map((row, at) => (at === index ? event.target.value : row)))}
          />
          <button
            type="button"
            className="studio-row-remove"
            aria-label={`Remove ${entry || `${label} ${index + 1}`}`}
            onClick={() => commit(rows.filter((_, at) => at !== index))}
          >
            <StudioIcon name="close" size={15} />
          </button>
        </div>
      ))}
      <button type="button" className="studio-row-add" onClick={() => setRows([...rows, ""])}>
        <StudioIcon name="plus" size={15} />
        Add
      </button>
    </div>
  );
}

// Which of a widget's fields it shows, in order. Until someone picks fields
// the section is one switch, "Use the widget's default fields", turned on
// (owner decision, 26 Oct 2026). Turning it off shows the field switches;
// nothing is written until a field is turned on, and turning it back on
// clears the list so the widget shows its own default fields again.
function VisibleFields({ field, value, onChange }) {
  const selected = Array.isArray(value) ? value.map(String) : [];
  const [picking, setPicking] = useState(selected.length > 0);
  const usingDefault = !picking && !selected.length;
  const contexts = field.choices?.length
    ? [{ choices: field.choices }]
    : (field.optionGroups || []).map((group, index) => ({
        title: group.label || group.context || group.name || `Set ${index + 1}`,
        choices: group.choices || group.fields || [],
      }));
  const full = field.maxItems && selected.length >= field.maxItems;
  const set = (next) => onChange(field.key, next.length ? next : undefined);
  const move = (choice, step) => {
    const next = [...selected];
    const from = next.indexOf(choice);
    const to = from + step;
    if (to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to], next[from]];
    set(next);
  };
  const choiceRow = (choice) => {
    const position = selected.indexOf(choice);
    const on = position >= 0;
    return (
      <div className={`studio-choice${on ? " studio-choice-on" : ""}`} key={choice}>
        <span className="studio-choice-order" aria-hidden="true">
          {on ? position + 1 : ""}
        </span>
        <span className="studio-choice-label">{humanize(choice)}</span>
        {on && selected.length > 1 && (
          <span className="studio-choice-move">
            <button
              type="button"
              aria-label={`Move ${humanize(choice)} up`}
              disabled={position === 0}
              onClick={() => move(choice, -1)}
            >
              <StudioIcon name="up" size={15} />
            </button>
            <button
              type="button"
              aria-label={`Move ${humanize(choice)} down`}
              disabled={position === selected.length - 1}
              onClick={() => move(choice, 1)}
            >
              <StudioIcon name="down" size={15} />
            </button>
          </span>
        )}
        <Switch
          label={humanize(choice)}
          checked={on}
          disabled={!on && Boolean(full)}
          onChange={(next) => set(next ? [...selected, choice] : selected.filter((entry) => entry !== choice))}
        />
      </div>
    );
  };
  // Chosen fields first, in their order, then the rest.
  const ordered = (choices) => [
    ...selected.filter((choice) => choices.includes(choice)),
    ...choices.filter((choice) => !selected.includes(choice)),
  ];
  return (
    <Group
      // Not "Visible fields": Show (below) arranges and hides values; this
      // is the widget's own list of which values it includes.
      title="Values it includes"
      aside={
        selected.length
          ? field.maxItems
            ? `${selected.length} of ${field.maxItems}`
            : `${selected.length} shown`
          : undefined
      }
      info={`The widget's own choice of values. It uses its usual set until you turn that off and pick values, in order. Show, further down, arranges and hides what it includes.${
        field.maxItems ? ` It can show up to ${field.maxItems}.` : ""
      }${contexts.length > 1 ? " Each set belongs to a different mode of the widget; choose from one set." : ""}`}
      className="studio-visible-fields"
    >
      <Row label="Its usual set">
        <Switch
          label="Its usual set"
          checked={usingDefault}
          onChange={(next) => {
            setPicking(!next);
            if (next) set([]);
          }}
        />
      </Row>
      {!usingDefault &&
        contexts.map((context, index) => (
          <div key={index} className="studio-choice-set">
            {context.title && <p className="studio-choice-set-title">{context.title}</p>}
            {ordered(context.choices.map(String)).map(choiceRow)}
          </div>
        ))}
    </Group>
  );
}

// Fields that say how to reach a service come first.
const CONNECTION_KEYS = new Set(["url", "key", "username", "password", "token", "headers", "version", "user", "pass"]);

export default function ConfigForm({
  value,
  onChange,
  fields = [],
  knownKeys = [],
  onValidity,
  docs,
  guide,
  setupNotes,
  name,
  testable = false,
  grouped = true,
  title,
  info,
  connections = false,
}) {
  const [tab, setTab] = useState("fields");
  // Whether a saved connection fills the address and key (connections.jsx).
  const [savedConnection, setSavedConnection] = useState(() => Boolean(savedConnectionId(value)));
  // A view disabled by an error in the other view points at that error.
  const yamlErrorId = useId();
  const [yaml, setYaml] = useState(() => dump(value, { noRefs: true, lineWidth: 100, sortKeys: false }));
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [lastValue, setLastValue] = useState(value);
  const invalid = Boolean(error) || Object.values(fieldErrors).some(Boolean);
  if (value !== lastValue) {
    setLastValue(value);
    // An adjacent settings control can change this same draft. Keep valid YAML
    // synchronized without discarding an incomplete YAML/JSON edit.
    if (!invalid) setYaml(dump(value, { noRefs: true, lineWidth: 100, sortKeys: false }));
  }
  useEffect(() => {
    onValidity?.(!invalid);
  }, [invalid, onValidity]);
  const fieldChange = (key, entry) => {
    const next = { ...value };
    if (entry === undefined) delete next[key];
    else next[key] = entry;
    setLastValue(next);
    onChange(next);
    setYaml(dump(next, { noRefs: true, lineWidth: 100, sortKeys: false }));
  };
  const yamlChange = (text) => {
    setYaml(text);
    try {
      const next = load(text) ?? {};
      if (!isObject(next)) throw new Error("This configuration must be a YAML mapping of option names to values.");
      assertSerializableValue(next);
      setLastValue(next);
      onChange(next);
      setError("");
      setFieldErrors({});
    } catch (err) {
      setError(yamlErrorMessage(err));
    }
  };
  const wholeChange = (next) => {
    setLastValue(next);
    onChange(next);
    setYaml(dump(next, { noRefs: true, lineWidth: 100, sortKeys: false }));
  };
  const fieldErrorIds = Object.keys(fieldErrors)
    .filter((key) => fieldErrors[key])
    .map((key) => `studio-field-${key}-error`);
  const known = new Set([...fields.map((field) => field.key), ...knownKeys]);
  const additional = Object.keys(value).filter((key) => !known.has(key) && key !== "type");
  const shown = fields.filter((field) => field.key !== "type");
  const picker = (field) => field.type === "array" && (field.choices?.length || field.optionGroups?.length);
  const fieldRow = (field) => (
    <Field
      key={field.key}
      field={field}
      value={value[field.key]}
      onChange={fieldChange}
      onError={(key, message) =>
        setFieldErrors((current) => ({
          ...current,
          [key]: message,
        }))
      }
    />
  );
  const connection = grouped
    ? shown.filter((field) => !picker(field) && (CONNECTION_KEYS.has(field.key) || field.sensitive))
    : [];
  const connectionKeys = connection.map((field) => field.key);
  const offersSaved = connections && connectionKeys.includes("url");
  const connectionRows =
    offersSaved && savedConnection ? connection.filter((field) => !CONNECTION_FIELDS.includes(field.key)) : connection;
  const pickers = shown.filter(picker);
  const options = shown.filter((field) => !picker(field) && !connection.includes(field));
  return (
    <div className="studio-config-form">
      <div className="studio-config-view">
        <span className="studio-muted" aria-hidden="true">
          Edit as
        </span>
        <Segmented
          label="Configuration view"
          value={tab}
          onChange={(next) => {
            if (next === "yaml" && tab !== "yaml")
              setYaml(dump(value, { noRefs: true, lineWidth: 100, sortKeys: false }));
            setTab(next);
          }}
          options={[
            ["fields", "Options", { disabled: Boolean(error), describedBy: error ? yamlErrorId : undefined }],
            ["yaml", "YAML", { disabled: fieldErrorIds.length > 0, describedBy: fieldErrorIds.join(" ") || undefined }],
          ]}
        />
      </div>
      {tab === "fields" ? (
        <>
          {connection.length > 0 && (
            <Group title="Connection">
              {offersSaved && (
                <ConnectionChooser
                  value={value}
                  keys={connectionKeys}
                  saved={savedConnection}
                  onSaved={setSavedConnection}
                  onChange={wholeChange}
                />
              )}
              {connectionRows.map(fieldRow)}
              {/* Test and Save as a connection share one row. */}
              <div className="studio-connection-actions">
                {testable && connectionKeys.includes("url") && (
                  // A new widget's draft has no type yet; testable names it.
                  <ConnectionTest
                    value={
                      typeof testable === "string" && value.type === undefined ? { ...value, type: testable } : value
                    }
                  />
                )}
                {offersSaved && !savedConnection && (
                  <ConnectionSave
                    value={value}
                    keys={connectionKeys}
                    onChange={wholeChange}
                    onSaved={setSavedConnection}
                  />
                )}
              </div>
            </Group>
          )}
          {pickers.map((field) => (
            <VisibleFields key={field.key} field={field} value={value[field.key]} onChange={fieldChange} />
          ))}
          {options.length > 0 && (
            <Group title={title || (connection.length ? "Options" : undefined)} info={info}>
              {options.map(fieldRow)}
            </Group>
          )}
          {!shown.length && <p className="studio-empty-note">This widget is set up in YAML.</p>}
          {additional.length > 0 && (
            <Group title="More options" info="These options have no control here. Change them in YAML.">
              {additional.map((key) => (
                <Row key={key} label={humanize(key)}>
                  <code className="studio-row-value">{key}</code>
                </Row>
              ))}
            </Group>
          )}
        </>
      ) : (
        <Group
          title="YAML"
          info="Every option for this item, including ones without a control. Numbers, lists and nested values keep their native form."
        >
          <textarea
            className="studio-code-editor"
            aria-label="Item configuration YAML"
            value={yaml}
            onChange={(event) => yamlChange(event.target.value)}
            spellCheck={false}
            rows={15}
          />
          {error && (
            <p className="studio-field-error" id={yamlErrorId} role="alert">
              {error}
            </p>
          )}
        </Group>
      )}
      {(guide?.length > 0 || setupNotes?.length > 0 || docs) && (
        <Disclosure title={name ? `Setting up ${name}` : "Setup guide"} icon="book">
          <Guide blocks={guide} notes={setupNotes} docs={docs} />
        </Disclosure>
      )}
    </div>
  );
}
