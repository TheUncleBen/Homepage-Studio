import { useTranslation } from "next-i18next/pages";
import { useId, useState } from "react";

import { BackgroundAdjust, BackgroundGrid, familyOf, FILL_FAMILIES } from "./background-picker";
import { PALETTE, partsFormat } from "./card-chart";
import { useCardTheme } from "./card-look";
import ColourField from "./colour-field";
import { IconField } from "./icon-chooser";
import StudioIcon from "./icons";
import { CHART_SHOWS, exactColour, setOverride } from "./look.mjs";
import { Group, Row, Segmented, Switch } from "./ui";

// Which parts of the widget dialog apply to each kind of widget (Rule 1: only
// show options that can apply).
const HAS_LOGO = new Set(["service", "serviceWidget", "bookmark"]);
const HAS_STATUS = new Set(["service", "serviceWidget"]);
const HAS_VALUES = new Set(["serviceWidget"]);
const HAS_LINK = new Set(["service", "serviceWidget", "bookmark"]);

export function lookSections(kind) {
  return {
    // Charts read the history Studio's collector keeps for integration widgets.
    charts: kind === "serviceWidget",
    logo: HAS_LOGO.has(kind),
    status: HAS_STATUS.has(kind),
    values: HAS_VALUES.has(kind),
    link: HAS_LINK.has(kind),
  };
}

// Several widgets edited together: a setting where they differ shows this
// value, so no choice is pressed and the row says "Mixed".
export const MIXED = "\u0000mixed";

// The sections every one of these kinds has (several widgets at once).
export function sharedSections(kinds) {
  const all = kinds.map(lookSections);
  return Object.fromEntries(Object.keys(lookSections("service")).map((key) => [key, all.every((one) => one[key])]));
}

function MixedNote({ value }) {
  return value === MIXED ? <span className="studio-mixed-note">Mixed</span> : null;
}

const newLookId = () =>
  globalThis.crypto?.randomUUID?.() || `look-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const lookOnly = (look = {}) => {
  const { values: _values, ...rest } = look;
  return rest;
};
export const sameLook = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

const SCOPE_NAMES = { me: "Just me", dashboard: "This dashboard" };

// Saved looks (board 24, owner request C2): a searchable list to apply one,
// save this widget's look under a name (Just me or This dashboard), and one
// place to rename, update or delete them. This dashboard's looks are saved
// with the dashboard; Just me looks are kept on the account at once.
// Updating one asks whether widgets that use it should change too.
function SavedLooks({ saved = [], look, onApply, onChange, personal, usage, onUpdateUsers }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState(null);
  const [managing, setManaging] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [asking, setAsking] = useState(null);
  const [error, setError] = useState(null);
  const panelId = useId();
  const current = lookOnly(look);
  const mine = personal?.available ? personal.looks || [] : [];
  const all = [...saved.map((entry) => ({ ...entry, scope: "dashboard" })), ...mine];
  const scopes = [...(onChange ? ["dashboard"] : []), ...(personal?.available ? ["me"] : [])];
  const canSave =
    scopes.length > 0 && Object.keys(current).length > 0 && !all.some((entry) => sameLook(entry.look, current));
  // Always shown where looks can be saved, so the section's summary holds
  // and the feature can be found before the first one is saved.
  if (!all.length && !scopes.length) return null;
  const chosen = all.find((entry) => sameLook(entry.look, current));
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle ? all.filter((entry) => entry.name.toLocaleLowerCase().includes(needle)) : all;
  const taken = (name, scope, except) =>
    all.some(
      (entry) =>
        entry.scope === scope &&
        entry.id !== except &&
        entry.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
    );
  const run = async (operation) => {
    setError(null);
    try {
      await operation();
      return true;
    } catch (err) {
      setError(err?.message || "That didn't save. Try again.");
      return false;
    }
  };
  const save = () =>
    run(async () => {
      const name = naming.name.trim();
      if (!name || name.length > 40 || taken(name, naming.scope)) return;
      if (naming.scope === "dashboard") onChange([...saved, { id: newLookId(), name, look: current }]);
      else await personal.change({ action: "add", kind: "look", scope: "me", name, look: current });
      setNaming(null);
    });
  const rename = (entry) =>
    run(async () => {
      const name = renaming.name.trim();
      if (!name || name.length > 40 || taken(name, entry.scope, entry.id)) return;
      if (entry.scope === "dashboard") onChange(saved.map((item) => (item.id === entry.id ? { ...item, name } : item)));
      else await personal.change({ action: "rename", kind: "look", scope: "me", id: entry.id, name });
      setRenaming(null);
    });
  const update = (entry) =>
    run(async () => {
      if (entry.scope === "dashboard")
        onChange(saved.map((item) => (item.id === entry.id ? { ...item, look: current } : item)));
      else await personal.change({ action: "update", kind: "look", scope: "me", id: entry.id, look: current });
      const count = usage ? usage(entry.look) : 0;
      if (count > 0 && onUpdateUsers) setAsking({ entry, from: entry.look, to: current, count });
    });
  const remove = (entry) =>
    run(async () => {
      if (entry.scope === "dashboard") onChange(saved.filter((item) => item.id !== entry.id));
      else await personal.change({ action: "delete", kind: "look", scope: "me", id: entry.id });
      setDeleting(null);
    });
  const scopeOf = (entry) => (scopes.length > 1 || entry.scope === "me" ? SCOPE_NAMES[entry.scope] : null);
  return (
    <Row
      label="Saved looks"
      stacked
      info="Pick a saved look to use it on this widget; it replaces the look, not the widget's values. Save this widget's look to reuse it on others."
    >
      <div className="studio-saved-looks">
        <button
          type="button"
          className="studio-saved-looks-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{chosen ? chosen.name : "None picked"}</span>
          <StudioIcon name="chevron" size={15} className="studio-saved-looks-chevron" />
        </button>
        {open && (
          <div id={panelId} className="studio-saved-looks-panel">
            {!managing && (
              <>
                {all.length > 4 && (
                  <input
                    type="search"
                    aria-label="Search saved looks"
                    placeholder="Search saved looks"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                )}
                {all.length > 0 && (
                  <ul className="studio-saved-looks-list" aria-label="Saved looks">
                    {shown.map((entry) => (
                      <li key={`${entry.scope}:${entry.id}`}>
                        <button
                          type="button"
                          aria-pressed={sameLook(entry.look, current)}
                          onClick={() => onApply(entry.look)}
                        >
                          <span className="studio-saved-look-title">{entry.name}</span>
                          {scopeOf(entry) && <span className="studio-saved-look-scope">{scopeOf(entry)}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {needle && !shown.length && <p className="studio-muted">No saved look matches “{query.trim()}”.</p>}
                {!all.length && (
                  <p className="studio-muted">No saved looks yet. Change this widget’s look, then save it here.</p>
                )}
                <div className="studio-saved-looks-actions">
                  {scopes.length > 0 && naming === null && (
                    <button
                      type="button"
                      className="studio-text-button"
                      disabled={!canSave}
                      title={
                        canSave
                          ? undefined
                          : Object.keys(current).length
                            ? "This look is already saved"
                            : "Change the look first; the default look needs no saving"
                      }
                      onClick={() => setNaming({ name: "", scope: scopes[0] })}
                    >
                      Save this look…
                    </button>
                  )}
                  {all.length > 0 && (onChange || personal?.available) && (
                    <button type="button" className="studio-text-button" onClick={() => setManaging(true)}>
                      Manage saved looks
                    </button>
                  )}
                </div>
              </>
            )}
            {managing && (
              <div className="studio-saved-looks-manage">
                <ul className="studio-saved-looks-list" aria-label="Manage saved looks">
                  {all
                    .filter((entry) => entry.scope !== "dashboard" || onChange)
                    .map((entry) => {
                      const key = `${entry.scope}:${entry.id}`;
                      return (
                        <li key={key} className="studio-saved-look-manage-row">
                          {renaming?.key === key ? (
                            <span className="studio-saved-look-name-edit">
                              <input
                                aria-label={`New name for ${entry.name}`}
                                maxLength={40}
                                value={renaming.name}
                                autoFocus
                                onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    rename(entry);
                                  } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setRenaming(null);
                                  }
                                }}
                              />
                              <button
                                type="button"
                                className="studio-button studio-quiet"
                                onClick={() => setRenaming(null)}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="studio-button studio-primary"
                                disabled={!renaming.name.trim() || taken(renaming.name, entry.scope, entry.id)}
                                onClick={() => rename(entry)}
                              >
                                Save
                              </button>
                            </span>
                          ) : deleting === key ? (
                            <span className="studio-saved-look-name-edit" role="alert">
                              <span>Delete “{entry.name}”? Widgets using it keep their look.</span>
                              <button
                                type="button"
                                className="studio-button studio-quiet"
                                onClick={() => setDeleting(null)}
                              >
                                Keep it
                              </button>
                              <button
                                type="button"
                                className="studio-button studio-danger"
                                onClick={() => remove(entry)}
                              >
                                Delete
                              </button>
                            </span>
                          ) : (
                            <>
                              <span className="studio-saved-look-text">
                                <span className="studio-saved-look-title">{entry.name}</span>
                                {scopeOf(entry) && <span className="studio-saved-look-scope">{scopeOf(entry)}</span>}
                              </span>
                              <button
                                type="button"
                                className="studio-button studio-quiet"
                                onClick={() => setRenaming({ key, name: entry.name })}
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                className="studio-button studio-quiet"
                                disabled={sameLook(entry.look, current) || !Object.keys(current).length}
                                title="Make it this widget's look"
                                onClick={() => update(entry)}
                              >
                                Update
                              </button>
                              <button
                                type="button"
                                className="studio-icon-button"
                                aria-label={`Delete saved look ${entry.name}`}
                                onClick={() => setDeleting(key)}
                              >
                                <StudioIcon name="trash" size={16} />
                              </button>
                            </>
                          )}
                        </li>
                      );
                    })}
                </ul>
                <p className="studio-note">Update makes a saved look this widget&apos;s look.</p>
                <button type="button" className="studio-text-button" onClick={() => setManaging(false)}>
                  Done
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {asking && (
        <div className="studio-saved-look-ask" role="alert">
          <span>
            {asking.count === 1 ? "1 other widget" : `${asking.count} other widgets`} on this dashboard{" "}
            {asking.count === 1 ? "uses" : "use"} “{asking.entry.name}”. Update {asking.count === 1 ? "it" : "them"}{" "}
            too?
          </span>
          <span className="studio-inline-actions">
            <button type="button" className="studio-button studio-quiet" onClick={() => setAsking(null)}>
              Leave {asking.count === 1 ? "it" : "them"}
            </button>
            <button
              type="button"
              className="studio-button studio-primary"
              onClick={() => {
                onUpdateUsers(asking.from, asking.to);
                setAsking(null);
              }}
            >
              Update {asking.count === 1 ? "it" : "them"}
            </button>
          </span>
        </div>
      )}
      {naming !== null && (
        <div className="studio-saved-look-name">
          <input
            aria-label="Name for this look"
            placeholder="For example Night"
            maxLength={40}
            value={naming.name}
            autoFocus
            onChange={(event) => setNaming({ ...naming, name: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setNaming(null);
              }
            }}
          />
          {scopes.length > 1 && (
            <Segmented
              label="Who can use it"
              value={naming.scope}
              onChange={(scope) => setNaming({ ...naming, scope })}
              options={scopes.map((scope) => [scope, SCOPE_NAMES[scope]])}
            />
          )}
          <button type="button" className="studio-button studio-quiet" onClick={() => setNaming(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="studio-button studio-primary"
            disabled={!naming.name.trim() || taken(naming.name, naming.scope)}
            onClick={save}
          >
            Save
          </button>
          {taken(naming.name, naming.scope) && <span className="studio-field-error">That name is taken.</span>}
        </div>
      )}
      {error && (
        <p className="studio-field-error" role="alert">
          {error}
        </p>
      )}
    </Row>
  );
}

// A row that only exists for the choice above it, drawn indented under it.
// Where the status check goes: the service's site monitor address (web) or
// ping host. Empty uses the service's own link.
function StatusAddress({ check, address }) {
  const id = useId();
  const ping = check === "ping";
  let host = "";
  try {
    host = address.href ? new URL(address.href).hostname : "";
  } catch {
    host = "";
  }
  return (
    <Row
      label="Address"
      htmlFor={id}
      info={
        ping
          ? "The host to ping. Leave it empty to ping the host of the widget's link."
          : "The address to check, often a health page. Leave it empty to check the widget's link."
      }
    >
      <input
        id={id}
        value={ping ? address.ping : address.web}
        inputMode={ping ? "text" : "url"}
        autoComplete="off"
        placeholder={(ping ? host : address.href) || (ping ? "host.example.org" : "https://service.example.org/health")}
        onChange={(event) => address.onChange(check, event.target.value.trim())}
      />
    </Row>
  );
}

function Dependent({ children }) {
  return <div className="studio-row-dependent">{children}</div>;
}

function Choice({ label, value, options, onChange, info }) {
  const id = useId();
  return (
    <Row label={label} info={info} htmlFor={undefined}>
      <MixedNote value={value} />
      <Segmented id={id} label={label} value={value} options={options} onChange={onChange} />
    </Row>
  );
}

// Show as (boards 6, 10), Rule 1: the formats this widget's numbers support.
// Numbers and Table always; charts over time need a number; parts of a whole
// need two numbers written the same way; a gauge needs a percentage.
export const SHOW_LABELS = {
  numbers: "Numbers",
  table: "Table",
  line: "Line chart",
  area: "Area chart",
  bar: "Bar chart",
  donut: "Donut",
  pie: "Pie",
  gauge: "Gauge",
  status: "Status history",
};
// statusCheck: the widget has a status check on, so its history can show.
export function showChoices(chartFields, current, statusCheck = false) {
  const fields = Array.isArray(chartFields) ? chartFields : [];
  const formats = fields.map((field) => field.format);
  const shared = formats.some((format, index) => formats.indexOf(format) !== index);
  const offered = [
    "numbers",
    "table",
    ...(fields.length ? ["line", "area", "bar"] : []),
    ...(shared ? ["donut", "pie"] : []),
    ...(formats.includes("percent") ? ["gauge"] : []),
    ...(statusCheck ? ["status"] : []),
  ];
  // A format chosen earlier stays listed, so the row still says what it is.
  if (current && !offered.includes(current)) offered.push(current);
  return offered.map((value) => [value, SHOW_LABELS[value]]);
}

function RulesEditor({ row, onChange }) {
  const rules = row.rules || {};
  const set = (key, text) => {
    const next = { ...rules };
    const value = text === "" ? undefined : Number(text);
    if (value === undefined || !Number.isFinite(value)) delete next[key];
    else next[key] = value;
    const kept = Object.fromEntries(Object.entries(next).filter(([key]) => key !== "lower"));
    onChange(Object.keys(kept).length ? next : undefined);
  };
  const warnId = useId();
  const problemId = useId();
  const hintId = useId();
  const unset = rules.warn === undefined && rules.problem === undefined;
  return (
    <div className="studio-value-rules" role="group" aria-label={`Colour rules for ${row.label}`}>
      <label htmlFor={warnId}>Warning from</label>
      <input
        id={warnId}
        type="number"
        inputMode="decimal"
        value={rules.warn ?? ""}
        onChange={(event) => set("warn", event.target.value)}
      />
      <label htmlFor={problemId}>Problem from</label>
      <input
        id={problemId}
        type="number"
        inputMode="decimal"
        value={rules.problem ?? ""}
        onChange={(event) => set("problem", event.target.value)}
      />
      <Switch
        label="Lower is worse"
        checked={Boolean(rules.lower)}
        disabled={unset}
        describedBy={unset ? hintId : undefined}
        onChange={(checked) => {
          const next = { ...rules };
          if (checked) next.lower = true;
          else delete next.lower;
          onChange(next);
        }}
      />
      <span className="studio-muted" aria-hidden="true">
        Lower is worse
      </span>
      {/* It only changes what a threshold means, so it waits for one. */}
      {unset && (
        <span id={hintId} className="studio-muted studio-rules-hint">
          Type a threshold first.
        </span>
      )}
    </div>
  );
}

// The widget's arrangement of its values: which one is the hero, their order,
// names and number style. Rows come back in display order, each with the
// widget's own label and anything the arrangement changes.
export function arrangeValues(fields, values = []) {
  const known = new Set(fields.map((field) => field.field));
  const byField = new Map(values.filter((value) => known.has(value.field)).map((value) => [value.field, value]));
  const order = [...byField.keys(), ...fields.map((field) => field.field).filter((field) => !byField.has(field))];
  return order.map((field) => {
    const stored = byField.get(field) || {};
    return {
      field,
      label: fields.find((entry) => entry.field === field)?.label || field,
      slot: stored.slot,
      format: stored.format,
      name: stored.label,
      colour: stored.colour,
      rules: stored.rules,
    };
  });
}

// What a widget stores (Rule 2): nothing while the rows are the widget's own
// order with nothing changed; otherwise every row in order, each with only
// the settings that differ from the widget's own.
export function storedValues(rows, fields) {
  const natural = fields.map((field) => field.field);
  const reordered = rows.some((row, index) => row.field !== natural[index]);
  const stored = rows.map(({ field, slot, format, name, colour, rules }) => ({
    field,
    ...(slot && slot !== "below" ? { slot } : {}),
    ...(name && name.trim() ? { label: name.trim() } : {}),
    ...(format && format !== "full" ? { format } : {}),
    ...(colour ? { colour } : {}),
    ...(rules ? { rules } : {}),
  }));
  if (!reordered && stored.every((entry) => Object.keys(entry).length === 1)) return undefined;
  return stored;
}

// The value a gauge draws: the chosen hero, else the first percentage, else
// the first value (as card-chart's CardChart picks it).
export function gaugeIndex(rows, formats = {}) {
  const chosen = rows.findIndex((row) => row.slot === "hero");
  if (chosen >= 0) return chosen;
  const percent = rows.findIndex((row) => formats[row.field] === "percent");
  return percent >= 0 ? percent : 0;
}

// The row a hero layout shows large: the chosen one, else the first shown.
export function heroIndex(rows) {
  const chosen = rows.findIndex((row) => row.slot === "hero");
  return chosen >= 0 ? chosen : rows.findIndex((row) => row.slot !== "hidden");
}

// A gauge shows one value (Rule 1): a picker for it and its colour rules.
function GaugeValue({ rows, formats, commit }) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const id = useId();
  const index = gaugeIndex(rows, formats);
  const row = rows[index];
  const known = Object.keys(formats).length > 0;
  const choices = rows.filter((entry) => !known || formats[entry.field] === "percent");
  if (!row) return null;
  const pick = (field) =>
    commit(
      rows.map((entry) => ({
        ...entry,
        slot: entry.field === field ? "hero" : entry.slot === "hero" ? undefined : entry.slot,
      })),
    );
  return (
    <>
      <Row label="Value" htmlFor={id} info="A gauge shows one percentage against 100.">
        <select id={id} value={row.field} onChange={(event) => pick(event.target.value)}>
          {choices.map((entry) => (
            <option key={entry.field} value={entry.field}>
              {entry.name || entry.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`studio-button studio-quiet studio-rules-toggle${row.rules ? " is-set" : ""}`}
          aria-expanded={rulesOpen}
          onClick={() => setRulesOpen(!rulesOpen)}
        >
          {row.rules ? "Rules on" : "Rules"}
        </button>
      </Row>
      {rulesOpen && (
        <RulesEditor
          row={row}
          onChange={(rules) =>
            commit(rows.map((entry, position) => (position === index ? { ...entry, rules } : entry)))
          }
        />
      )}
    </>
  );
}

// The native key of a value (pfsense.wanIP -> wanIP), for the widget's own
// fields list; null when the value isn't one of the widget's choices.
export function nativeKey(field, prefix, choices) {
  const key = typeof field === "string" && field.startsWith(`${prefix}.`) ? field.slice(prefix.length + 1) : field;
  return choices.includes(key) ? key : null;
}

// One list of every value the widget can show (board 27), in your order.
// Values the widget isn't drawing yet (not in its fields list) are listed
// too, hidden; showing one adds it to that list, hiding one removes it, and
// the list keeps your order, so the YAML always says what the card shows.
export function withNativeValues(fields, choices = [], prefix = "") {
  const present = new Set(fields.map((field) => field.field));
  return [
    ...fields,
    ...choices
      .map((choice) => `${prefix}.${choice}`)
      .filter((field) => !present.has(field))
      .map((field) => ({ field, label: field, absent: true })),
  ];
}

function ValueList({
  fields: reported,
  values,
  layout,
  show = "numbers",
  formats = {},
  onChange,
  choices = [],
  prefix = "",
  nativeFields,
  onNativeFields,
}) {
  const { t } = useTranslation();
  const synced = Boolean(onNativeFields && choices.length);
  const fields = synced ? withNativeValues(reported, choices, prefix) : reported;
  // A value the widget isn't drawing yet shows as hidden, unless its fields
  // list (the draft) already asks for it: "Below" is the default and isn't
  // stored, so without this a value just shown went straight back to hidden
  // (owner T8 on 65f724c: values stuck hidden until fields was typed in YAML).
  const asked = new Set(
    (nativeFields || []).map((key) => (String(key).includes(".") ? String(key) : `${prefix}.${key}`)),
  );
  const absent = new Set(fields.filter((field) => field.absent && !asked.has(field.field)).map((field) => field.field));
  // Widgets name their values with translation keys (adguard.queries).
  const rows = arrangeValues(fields, values).map((row) => ({
    ...row,
    label: t(row.label),
    ...(absent.has(row.field) && !row.slot ? { slot: "hidden" } : {}),
  }));
  const [rulesOpen, setRulesOpen] = useState(null);
  // Donut and pie draw only the values in one format (card-chart partsFormat).
  const partsUnit =
    (show === "donut" || show === "pie") && Object.keys(formats).length
      ? partsFormat(Object.entries(formats).map(([field, format]) => ({ field, format })))
      : null;
  const coloured = ["line", "area", "bar", "donut", "pie"].includes(show);
  // Which native fields the rows ask for, in their order.
  const nativeOf = (next) =>
    next
      .filter((row) => row.slot !== "hidden")
      .map((row) => nativeKey(row.field, prefix, choices))
      .filter(Boolean);
  const commit = (next) => {
    onChange(storedValues(next, fields));
    if (!synced) return;
    const wanted = nativeOf(next);
    // The widget stays on its usual set until what it shows or their order
    // changes. Homepage can't be told to show none, so hiding the last value
    // hides it in the card only.
    if (!wanted.length) return;
    if (!nativeFields?.length && JSON.stringify(wanted) === JSON.stringify(nativeOf(rows))) return;
    if (JSON.stringify(wanted) !== JSON.stringify(nativeFields ?? null)) onNativeFields(wanted);
  };
  // Donut and pie draw every shown value as a part, so there is no hero row.
  const heroed = layout === "hero" && show !== "donut" && show !== "pie";
  const hero = heroed ? heroIndex(rows) : -1;
  const update = (index, patch) => {
    let next = rows.map((row, position) => {
      if (position === index) return { ...row, ...patch };
      // One hero at a time: choosing a new one returns the old one below.
      if (patch.slot === "hero" && row.slot === "hero") return { ...row, slot: undefined };
      return row;
    });
    // Moving the hero below hands the hero to the next shown value.
    if (index === hero && patch.slot === "below") {
      const following = next.findIndex((row, position) => position !== index && row.slot !== "hidden");
      next = next.map((row, position) => {
        if (position === index) return { ...row, slot: undefined };
        if (position === following) return { ...row, slot: "hero" };
        return row;
      });
    }
    commit(next);
  };
  const move = (index, step) => {
    const next = [...rows];
    const [entry] = next.splice(index, 1);
    next.splice(index + step, 0, entry);
    commit(next);
  };
  if (show === "gauge") return <GaugeValue rows={rows} formats={formats} commit={commit} />;
  // Board 27: on a chart each value goes in the chart, beside it as a
  // number, or nowhere.
  const charted = CHART_SHOWS.includes(show) || show === "donut" || show === "pie";
  const slots = charted
    ? [
        ["below", "Chart"],
        ["number", "Number"],
        ["hidden", "Hidden"],
      ]
    : heroed
      ? [
          ["hero", "Hero"],
          ["below", "Below"],
          ["hidden", "Hidden"],
        ]
      : [
          ["below", "Shown"],
          ["hidden", "Hidden"],
        ];
  // The colour each value gets on a chart unless it has its own, as the
  // chart counts them (card-chart chartSeries): by its place among the
  // charted values, hidden ones included, so hiding one recolours nothing.
  // Picking that colour again stores nothing (Rule 2).
  const shownSlot = (row, index) => {
    if (index === hero && !charted) return "hero";
    if (row.slot === "number") return charted ? "number" : "below";
    return row.slot === "hero" || !row.slot ? "below" : row.slot;
  };
  const known = Object.keys(formats).length > 0;
  const defaultColour = new Map(
    rows
      .filter((row) => !known || formats[row.field])
      .map((row, position) => [row.field, PALETTE[position % PALETTE.length]]),
  );
  return (
    <ol className="studio-value-list">
      {rows.map((row, index) => {
        if (partsUnit && formats[row.field] && formats[row.field] !== partsUnit) return null;
        const slot = shownSlot(row, index);
        return (
          <li key={row.field}>
            <div className="studio-value-order">
              <button
                type="button"
                className="studio-icon-button"
                aria-label={`Move ${row.label} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <StudioIcon name="chevronUp" size={14} />
              </button>
              <button
                type="button"
                className="studio-icon-button"
                aria-label={`Move ${row.label} down`}
                disabled={index === rows.length - 1}
                onClick={() => move(index, 1)}
              >
                <StudioIcon name="chevronDown" size={14} />
              </button>
            </div>
            <input
              aria-label={`Name shown for ${row.label}`}
              value={row.name || ""}
              placeholder={row.label}
              maxLength={40}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <Segmented
              label={`Where ${row.label} shows`}
              value={slot}
              options={slots}
              onChange={(value) => update(index, { slot: value })}
            />
            <select
              className="studio-value-format"
              aria-label={`Number style for ${row.label}`}
              value={row.format || "full"}
              onChange={(event) => update(index, { format: event.target.value })}
            >
              <option value="full">1,234,567</option>
              <option value="short">1.2M</option>
              <option value="compact">1.2 M</option>
            </select>
            {coloured &&
              (slot !== "hidden" && (row.colour || defaultColour.has(row.field)) ? (
                <ColourField
                  label={`Chart colour for ${row.label}`}
                  value={row.colour || defaultColour.get(row.field)}
                  onChange={(colour) =>
                    update(index, { colour: colour === defaultColour.get(row.field) ? undefined : colour })
                  }
                />
              ) : (
                // Holds the colour's column, so every row lines up.
                <span className="studio-value-no-colour" />
              ))}
            <button
              type="button"
              className={`studio-button studio-quiet studio-rules-toggle${row.rules ? " is-set" : ""}`}
              aria-expanded={rulesOpen === row.field}
              onClick={() => setRulesOpen(rulesOpen === row.field ? null : row.field)}
            >
              {row.rules ? "Rules on" : "Rules"}
            </button>
            {rulesOpen === row.field && <RulesEditor row={row} onChange={(rules) => update(index, { rules })} />}
          </li>
        );
      })}
    </ol>
  );
}

// The Look, Status, Show and Behaviour sections of the widget dialog. `look`
// and `behaviour` are the widget's own sparse overrides; `inherited*` is what
// it gets from the dashboard. Every change goes through setOverride, so a
// value equal to the dashboard's removes the key (Rule 2).
// Whether the Values and charts part has anything to show. A widget showing
// its status history reports no values, so the part stays to switch back.
export function valuesPartShown({ show, fields = [], nativeValues, effective }) {
  return Boolean(
    show.values && (fields.length > 0 || nativeValues?.choices?.length > 0 || effective.show === "status"),
  );
}

const FILL_LABELS = { plain: "Plain", tint: "Tint", solid: "Solid", picture: "Picture", pattern: "Pattern" };
const EDGE_LABELS = { line: "line", shadow: "shadow", both: "line and shadow", none: "no edge" };
const CORNER_LABELS = { square: "square", default: "default corners", round: "round" };
const CHECK_LABELS = { web: "Web address", ping: "Ping", off: "No status check" };
const CLICK_LABELS = { same: "opens link", new: "opens in a new tab", none: "no click" };

// The one-line summaries beside each closed section (board 24), so what a
// widget is set to reads without opening anything.
export function lookSummaries({ kind, look = {}, behaviour = {}, inheritedLook, inheritedBehaviour, savedLooks = [] }) {
  const show = lookSections(kind);
  const effective = { ...inheritedLook, ...look };
  const acts = { ...inheritedBehaviour, ...behaviour };
  const own = lookOnly(look);
  const saved = Object.keys(own).length ? savedLooks.find((entry) => sameLook(entry.look, own)) : null;
  const shape = [FILL_LABELS[effective.fill], CORNER_LABELS[effective.corners], EDGE_LABELS[effective.edge]]
    .filter(Boolean)
    .join(", ");
  const showing =
    effective.show === "numbers" || !effective.show
      ? effective.layout === "quiet"
        ? "Quiet"
        : "Hero"
      : SHOW_LABELS[effective.show] || "";
  const status = [show.status && CHECK_LABELS[acts.status], show.link && CLICK_LABELS[acts.target]]
    .filter(Boolean)
    .join(" · ");
  return { look: saved ? saved.name : shape, values: showing, status };
}

export default function LookEditor({
  kind,
  look = {},
  behaviour = {},
  inheritedLook,
  inheritedBehaviour,
  fields = [],
  pages = [],
  pageId,
  onLook,
  onBehaviour,
  onPage,
  part = "all",
  sections,
  savedLooks,
  onSavedLooks,
  // Just me looks ({ available, looks, change }) and the widgets on this
  // dashboard that use a look, for Manage saved looks › Update.
  personalLooks,
  lookUsage,
  onUpdateLookUsers,
  statusAddress,
  // An integration widget's own logo and description ({ icon, description,
  // onIcon, onDescription }), shown with the header that draws them.
  identity,
  // The widget's own fields list and its choices (board 27): the Values list
  // shows every choice and keeps that list in sync.
  nativeValues,
  chartFields,
  // The time ranges the dashboard keeps history for (card-chart chartRanges).
  rangeChoices = ["1h", "6h", "24h", "7d", "30d"],
}) {
  const show = sections || lookSections(kind);
  const showId = useId();
  // The widget dialog shows each part in its own section (board 25): look,
  // values (Values and charts), status (Status and behaviour) and page.
  // "all" shows every part at once (several widgets edited together).
  const inPart = (name) => part === "all" || part === name;
  const sectioned = part !== "all";
  const effective = { ...inheritedLook, ...look };
  const acts = { ...inheritedBehaviour, ...behaviour };
  const setLook = (key, value) => onLook(setOverride(look, key, value, inheritedLook));
  const setBehaviour = (key, value) => onBehaviour(setOverride(behaviour, key, value, inheritedBehaviour));
  const tinted = effective.fill === "tint" || effective.fill === "solid";
  const pictured = effective.fill === "picture" || effective.fill === "pattern";
  const theme = useCardTheme();
  // A background from the other kind of fill doesn't apply to this one.
  const backgroundFamily = familyOf(effective.background);
  const chosenBackground =
    pictured &&
    effective.background &&
    (FILL_FAMILIES[effective.fill].includes(backgroundFamily) ||
      (effective.fill === "picture" && backgroundFamily === "upload"))
      ? effective.background
      : null;
  const colourMixed = effective.colour === MIXED;
  const custom = !colourMixed && effective.colour !== "logo";
  const named = effective.header === "logo-name" || effective.header === "name";
  return (
    <div className="studio-look-editor">
      {inPart("look") && (
        <Group title={sectioned ? undefined : "Look"}>
          <SavedLooks
            saved={savedLooks}
            look={look}
            onChange={onSavedLooks}
            personal={personalLooks}
            usage={lookUsage}
            onUpdateUsers={onUpdateLookUsers}
            onApply={(saved) => onLook({ ...saved, ...(look.values !== undefined ? { values: look.values } : {}) })}
          />
          {show.values && (!show.charts || effective.show === "numbers" || effective.show === MIXED) && (
            <>
              <Choice
                label="Layout"
                value={effective.layout}
                onChange={(value) => setLook("layout", value)}
                options={[
                  ["hero", "Hero"],
                  ["quiet", "Quiet"],
                ]}
                info="Hero shows one value large with the rest below it. Quiet shows every value the same size."
              />
              {effective.layout === "hero" && (
                <Dependent>
                  <Choice
                    label="Hero size"
                    value={effective.heroSize}
                    onChange={(value) => setLook("heroSize", value)}
                    options={[
                      ["s", "S"],
                      ["m", "M"],
                      ["l", "L"],
                      ["xl", "XL"],
                    ]}
                  />
                </Dependent>
              )}
            </>
          )}
          <Choice
            label="Fill"
            value={effective.fill}
            onChange={(value) => setLook("fill", value)}
            options={[
              ["plain", "Plain"],
              ["tint", "Tint"],
              ["solid", "Solid"],
              ["picture", "Picture"],
              ["pattern", "Pattern"],
            ]}
          />
          {pictured && (
            <Dependent>
              <Row label="Background" stacked>
                <BackgroundGrid
                  key={effective.fill}
                  fill={effective.fill}
                  value={chosenBackground}
                  tokens={theme}
                  onPick={(id, source) =>
                    setLook("background", {
                      ...(chosenBackground?.id === id ? chosenBackground : {}),
                      source,
                      id,
                    })
                  }
                />
              </Row>
              {chosenBackground && (
                <BackgroundAdjust
                  background={chosenBackground}
                  tokens={theme}
                  onChange={(background) => setLook("background", background)}
                />
              )}
            </Dependent>
          )}
          {tinted && (
            <Dependent>
              <Row label="Colour">
                <div className="studio-colour-choice">
                  <MixedNote value={effective.colour} />
                  <Segmented
                    label="Colour"
                    value={colourMixed ? MIXED : custom ? "custom" : "logo"}
                    onChange={(value) =>
                      setLook("colour", value === "logo" ? "logo" : hexOr(look.colour, inheritedLook.colour))
                    }
                    options={[
                      ["logo", show.logo ? "From logo" : "Accent"],
                      ["custom", "Custom"],
                    ]}
                  />
                  {custom && (
                    <ColourField
                      label="Card colour"
                      value={effective.colour}
                      onChange={(colour) => setLook("colour", colour)}
                    />
                  )}
                </div>
              </Row>
              {custom && (
                <Row
                  label="Exact colour"
                  info="Studio fits a colour to the theme so it never glows or turns muddy. Use your exact colour to turn that off; text still picks its most readable colour."
                >
                  <MixedNote value={effective.colourFit} />
                  <Switch
                    label="Use my exact colour"
                    checked={effective.colourFit === "exact"}
                    onChange={(on) => setLook("colourFit", on ? "exact" : "fitted")}
                  />
                </Row>
              )}
              {custom && effective.colourFit === "exact" && exactColour(effective.colour, theme)?.contrast < 4.5 && (
                <p className="studio-callout studio-callout-warn" role="status">
                  Text on this colour reaches only {exactColour(effective.colour, theme).contrast}:1, below the 4.5:1
                  that keeps it easy to read.
                </p>
              )}
              {/* An exact solid colour has no strength to choose. */}
              {!(effective.fill === "solid" && custom && effective.colourFit === "exact") && (
                <Choice
                  label="Strength"
                  value={effective.strength}
                  onChange={(value) => setLook("strength", value)}
                  options={[
                    ["soft", "Soft"],
                    ["medium", "Medium"],
                    ["strong", "Strong"],
                  ]}
                />
              )}
            </Dependent>
          )}
          <Choice
            label="Edge"
            value={effective.edge}
            onChange={(value) => setLook("edge", value)}
            options={[
              ["line", "Line"],
              ["shadow", "Shadow"],
              ["both", "Both"],
              ["none", "None"],
            ]}
          />
          <Choice
            label="Corners"
            value={effective.corners}
            onChange={(value) => setLook("corners", value)}
            options={[
              ["square", "Square"],
              ["default", "Default"],
              ["round", "Round"],
            ]}
          />
          {show.logo && (
            <>
              <Choice
                label="Header"
                value={effective.header}
                onChange={(value) => setLook("header", value)}
                options={[
                  ["logo-name", "Logo and name"],
                  ["logo", "Logo"],
                  ["name", "Name"],
                  ["hidden", "None"],
                ]}
              />
              {identity && (effective.header === "logo-name" || effective.header === "logo") && (
                <Dependent>
                  <Row label="Logo" htmlFor={`${showId}-logo`}>
                    <IconField
                      id={`${showId}-logo`}
                      label="logo"
                      value={identity.icon || ""}
                      onChange={identity.onIcon}
                      emptyText="No logo"
                    />
                  </Row>
                </Dependent>
              )}
              {named && (
                <Dependent>
                  <Choice
                    label="Description"
                    value={effective.description}
                    onChange={(value) => setLook("description", value)}
                    options={[
                      ["show", "Show"],
                      ["hide", "Hide"],
                    ]}
                  />
                </Dependent>
              )}
              {identity && named && effective.description !== "hide" && (
                <Dependent>
                  <Row label="Description text" htmlFor={`${showId}-description`}>
                    <input
                      id={`${showId}-description`}
                      type="text"
                      value={identity.description || ""}
                      onChange={(event) => identity.onDescription(event.target.value)}
                      placeholder="A line under the name"
                      maxLength={200}
                    />
                  </Row>
                </Dependent>
              )}
            </>
          )}
          {show.values && (
            <Choice
              label="Numbers"
              value={effective.numbers}
              onChange={(value) => setLook("numbers", value)}
              options={[
                ["sans", "Regular"],
                ["mono", "Monospaced"],
              ]}
            />
          )}
          <Choice
            label="Align"
            value={effective.align}
            onChange={(value) => setLook("align", value)}
            options={[
              ["left", "Left"],
              ["centre", "Centre"],
            ]}
          />
        </Group>
      )}
      {inPart("status") && show.status && (
        <Group title="Status">
          <Choice
            label="Check by"
            value={acts.status}
            onChange={(value) => {
              setBehaviour("status", value);
              // Status history needs a check; without one it goes back to the default.
              if (value === "off" && effective.show === "status") setLook("show", "numbers");
            }}
            options={[
              ["web", "Web address"],
              ["ping", "Ping"],
              ["off", "Off"],
            ]}
            info="Web address checks the status address when one is set, otherwise the widget's Connection address or its link. Ping uses the same address's host."
          />
          {acts.status !== "off" && (
            <Dependent>
              {statusAddress && <StatusAddress check={acts.status} address={statusAddress} />}
              <Choice
                label="Style"
                value={effective.status}
                onChange={(value) => setLook("status", value)}
                options={[
                  ["dot", "Dot"],
                  ["updown", "Up / Down"],
                  ["time", "Response time"],
                ]}
              />
              {/* A service tile has no Show section, so its status history is
                  switched on here; an integration widget picks it in Show as. */}
              {!show.values && (
                <Row
                  label="History"
                  info="A bar for each check, about one a minute, with the share of checks that were up. Studio keeps them for this widget only while this is on."
                >
                  <MixedNote value={effective.show} />
                  <Switch
                    label="Show status history"
                    checked={effective.show === "status"}
                    onChange={(on) => setLook("show", on ? "status" : "numbers")}
                  />
                </Row>
              )}
              {effective.show === "status" && (
                <Choice
                  label="Uptime over"
                  value={effective.chartRange}
                  onChange={(value) => setLook("chartRange", value)}
                  options={rangeChoices.map((key) => [key, key.replace(/(\d)([hd])/, "$1 $2")])}
                />
              )}
            </Dependent>
          )}
        </Group>
      )}
      {/* A widget showing its status history shows no values, so it reports
          none; Show stays so it can be switched back. */}
      {inPart("values") && valuesPartShown({ show, fields, nativeValues, effective }) && (
        <Group
          title="Show"
          info="The values this widget showed last. Pick the hero, hide what you don't need, rename a value or change how its number reads."
        >
          {show.charts && (
            <Row
              label="Show as"
              htmlFor={showId}
              info="Charts use history Studio keeps for this widget, about one value a minute."
            >
              <select id={showId} value={effective.show} onChange={(event) => setLook("show", event.target.value)}>
                {showChoices(chartFields, effective.show, acts.status !== "off").map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </Row>
          )}
          {/* Status history's range is Uptime over, in the Status section. */}
          {show.charts && CHART_SHOWS.includes(effective.show) && (
            <Dependent>
              <Choice
                label="Time range"
                value={effective.chartRange}
                onChange={(value) => setLook("chartRange", value)}
                options={rangeChoices.map((key) => [key, key.replace(/(\d)([hd])/, "$1 $2")])}
              />
            </Dependent>
          )}
          {/* A trend needs a number the collector can keep (Rule 1). */}
          {show.charts &&
            effective.show === "numbers" &&
            effective.layout === "hero" &&
            ((Array.isArray(chartFields) && chartFields.length > 0) ||
              (effective.trend && effective.trend !== "off")) && (
              <Choice
                label="Trend"
                value={effective.trend}
                onChange={(value) => setLook("trend", value)}
                options={[
                  ["off", "Off"],
                  ["hour", "Last hour"],
                  ["day", "Yesterday"],
                  ["week", "Last week"],
                ]}
                info="The change in the large value since then, from the history Studio keeps for this widget."
              />
            )}
          {effective.show !== "status" && (
            <ValueList
              fields={fields}
              values={look.values || []}
              layout={effective.show === "numbers" ? effective.layout : "hero"}
              show={effective.show}
              formats={Object.fromEntries(
                (Array.isArray(chartFields) ? chartFields : []).map((f) => [f.field, f.format]),
              )}
              onChange={(values) => setLook("values", values)}
              choices={nativeValues?.choices}
              prefix={nativeValues?.prefix}
              nativeFields={nativeValues?.fields}
              onNativeFields={nativeValues?.onChange}
            />
          )}
        </Group>
      )}
      {inPart("status") && (
        <Group title="Behaviour">
          {show.link && (
            <Choice
              label="On click"
              value={acts.target}
              onChange={(value) => setBehaviour("target", value)}
              options={[
                ["same", "Same tab"],
                ["new", "New tab"],
                ["none", "Nothing"],
              ]}
            />
          )}
          <Choice
            label="On phones"
            value={acts.phones}
            onChange={(value) => setBehaviour("phones", value)}
            options={[
              ["show", "Show"],
              ["hide", "Hide"],
            ]}
            info="Hide keeps the widget off screens narrower than a tablet. It stays in place everywhere else."
          />
          {show.values && (
            <>
              <Choice
                label="Refresh"
                value={acts.refresh}
                onChange={(value) => setBehaviour("refresh", value)}
                options={[
                  ["auto", "Auto"],
                  ["10s", "10 s"],
                  ["30s", "30 s"],
                  ["1m", "1 min"],
                  ["5m", "5 min"],
                ]}
                info="Auto uses the integration's own refresh interval."
              />
              <Choice
                label="Errors"
                value={acts.errors}
                onChange={(value) => setBehaviour("errors", value)}
                options={[
                  ["link", "Show a fix link"],
                  ["hide", "Hide"],
                ]}
                info="Hide keeps the last values, greyed, with the time they were read."
              />
            </>
          )}
        </Group>
      )}
      {inPart("page") && pages.length > 1 && onPage && (
        <Group>
          <Row label="Page" htmlFor="studio-widget-page">
            <select id="studio-widget-page" value={pageId} onChange={(event) => onPage(event.target.value)}>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
            </select>
          </Row>
        </Group>
      )}
    </div>
  );
}

function hexOr(...candidates) {
  return candidates.find((value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) || "#b299be";
}
