import { dump, load } from "js-yaml";
import { useEffect, useId, useState } from "react";

import { isObject } from "./native-adapter.mjs";

export const LINK_FIELDS = [
  { key: "href", label: "Destination URL", type: "string" },
  { key: "description", label: "Description", type: "string" },
  { key: "icon", label: "Icon", type: "string", exampleValue: "mdi-server" },
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
  { key: "description", label: "Description", type: "string" },
  { key: "language", label: "Language", type: "string", exampleValue: "en" },
  {
    key: "target",
    label: "Default link target",
    type: "string",
    exampleValue: "_blank",
  },
  { key: "theme", label: "Native theme", type: "string", exampleValue: "dark" },
  {
    key: "color",
    label: "Native widget color palette",
    type: "string",
    exampleValue: "slate",
  },
  {
    key: "background",
    label: "Background",
    type: "object",
    valueTypes: ["string", "object"],
  },
  { key: "quicklaunch", label: "Quick Launch", type: "object" },
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
  value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value, null, 2)
      : String(value);

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

function Field({ field, value, onChange, onError }) {
  const actualType =
    value === undefined
      ? field.type
      : Array.isArray(value)
        ? "array"
        : typeof value;
  const [kind, setKind] = useState(
    actualType === "null" ? field.type : actualType,
  );
  const [text, setText] = useState(encode(value));
  const [error, setError] = useState("");
  const [reveal, setReveal] = useState(false);
  const [previousValue, setPreviousValue] = useState(value);
  if (!Object.is(previousValue, value)) {
    setPreviousValue(value);
    setText(encode(value));
    if (value !== undefined)
      setKind(Array.isArray(value) ? "array" : typeof value);
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
        if (newKind === "array" ? !Array.isArray(parsed) : !isObject(parsed))
          throw new Error(`Use a JSON ${newKind}.`);
        assertSerializableValue(parsed);
      } else parsed = next;
    } catch (err) {
      message = err.message;
    }
    setError(message);
    onError(field.key, message);
    if (!message) onChange(field.key, parsed);
  };
  const id = `studio-field-${field.key}`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : undefined;
  const complex = kind === "object" || kind === "array";
  const placeholder =
    field.exampleValue === undefined
      ? "Not configured"
      : encode(field.exampleValue);
  return (
    <div className={`studio-field${complex ? " studio-field-full" : ""}`}>
      <label htmlFor={id}>
        {field.label || field.key}
        <code aria-hidden="true">{field.key}</code>
      </label>
      {field.valueTypes?.length > 1 && (
        <select
          className="studio-value-type"
          aria-label={`${field.label || field.key} value type`}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
            update("", event.target.value);
          }}
        >
          {field.valueTypes.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      )}
      {kind === "boolean" ? (
        <select
          id={id}
          value={text}
          onChange={(event) => update(event.target.value)}
        >
          <option value="">Use native default</option>
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
      ) : complex ? (
        <textarea
          id={id}
          value={text}
          onChange={(event) => update(event.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
      ) : (
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
              className="studio-text-button"
              onClick={() => setReveal(!reveal)}
            >
              {reveal ? "Hide" : "Show"}
            </button>
          )}
        </div>
      )}
      {field.choices?.length > 0 && kind === "array" && (
        <div
          className="studio-field-choices"
          aria-label={`${field.label || field.key} choices`}
        >
          {field.choices.map((choice) => (
            <label key={choice}>
              <input
                type="checkbox"
                checked={Array.isArray(value) && value.includes(choice)}
                onChange={(event) =>
                  update(
                    JSON.stringify(
                      event.target.checked
                        ? [...(Array.isArray(value) ? value : []), choice]
                        : (value || []).filter((entry) => entry !== choice),
                    ),
                  )
                }
              />
              {choice}
            </label>
          ))}
        </div>
      )}
      {field.description && (
        <small className="studio-muted">{field.description}</small>
      )}
      {field.optionGroups?.length > 0 && (
        <details className="studio-note">
          <summary>Native field choices by context</summary>
          {field.optionGroups.map((group, index) => (
            <p key={index}>
              <strong>
                {group.label ||
                  group.context ||
                  group.name ||
                  `Context ${index + 1}`}
                :{" "}
              </strong>
              {(group.choices || group.fields || []).join(", ")}
            </p>
          ))}
        </details>
      )}
      {field.maxItems && (
        <small className="studio-muted">
          Native display supports up to {field.maxItems} selected fields.
        </small>
      )}
      {error && (
        <small id={errorId} className="studio-field-error">
          {error}
        </small>
      )}
    </div>
  );
}

export default function ConfigForm({
  value,
  onChange,
  fields = [],
  knownKeys = [],
  onValidity,
  docs,
  notice,
}) {
  const [tab, setTab] = useState("fields");
  // A view disabled by an error in the other view points at that error.
  const yamlErrorId = useId();
  const [yaml, setYaml] = useState(() =>
    dump(value, { noRefs: true, lineWidth: 100, sortKeys: false }),
  );
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [lastValue, setLastValue] = useState(value);
  const invalid = Boolean(error) || Object.values(fieldErrors).some(Boolean);
  if (value !== lastValue) {
    setLastValue(value);
    // An adjacent settings control can change this same draft. Keep valid YAML
    // synchronized without discarding an incomplete YAML/JSON edit.
    if (!invalid)
      setYaml(dump(value, { noRefs: true, lineWidth: 100, sortKeys: false }));
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
      if (!isObject(next))
        throw new Error(
          "This configuration must be a YAML mapping of option names to values.",
        );
      assertSerializableValue(next);
      setLastValue(next);
      onChange(next);
      setError("");
      setFieldErrors({});
    } catch (err) {
      setError(yamlErrorMessage(err));
    }
  };
  const fieldErrorIds = Object.keys(fieldErrors)
    .filter((key) => fieldErrors[key])
    .map((key) => `studio-field-${key}-error`);
  const known = new Set([...fields.map((field) => field.key), ...knownKeys]);
  const additional = Object.keys(value).filter(
    (key) => !known.has(key) && key !== "type",
  );
  return (
    <div className="studio-config-form">
      <nav className="studio-tabs" aria-label="Configuration view">
        <button
          type="button"
          className={tab === "fields" ? "studio-tab-active" : ""}
          aria-pressed={tab === "fields"}
          disabled={Boolean(error)}
          aria-describedby={error ? yamlErrorId : undefined}
          onClick={() => setTab("fields")}
        >
          Options
        </button>
        <button
          type="button"
          className={tab === "yaml" ? "studio-tab-active" : ""}
          aria-pressed={tab === "yaml"}
          disabled={fieldErrorIds.length > 0}
          aria-describedby={fieldErrorIds.join(" ") || undefined}
          onClick={() => {
            if (tab !== "yaml")
              setYaml(
                dump(value, { noRefs: true, lineWidth: 100, sortKeys: false }),
              );
            setTab("yaml");
          }}
        >
          Advanced YAML
        </button>
        {docs && (
          <a href={docs} target="_blank" rel="noreferrer">
            Native documentation ↗
          </a>
        )}
      </nav>
      {tab === "fields" ? (
        <>
          <div className="studio-fields-grid">
            {fields
              .filter((field) => field.key !== "type")
              .map((field) => (
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
              ))}
          </div>
          {!fields.length && (
            <p className="studio-muted">
              Use Advanced YAML for the options supported by this native widget.
            </p>
          )}
          {additional.length > 0 && (
            <p className="studio-note">
              {additional.length} additional option
              {additional.length === 1 ? "" : "s"} preserved:{" "}
              {additional.map((key) => (
                <code key={key}>{key} </code>
              ))}
              . Edit these in Advanced YAML.
            </p>
          )}
          {notice && <p className="studio-note">{notice}</p>}
        </>
      ) : (
        <>
          <p className="studio-note">
            Edit this item’s options. Native numbers, booleans, lists, nested
            values and unlisted options are preserved. The complete files are
            available in Dashboard settings → Configuration files.
          </p>
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
        </>
      )}
    </div>
  );
}
