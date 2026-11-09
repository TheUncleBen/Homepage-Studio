import { useTranslation } from "next-i18next/pages";
import { useId, useState } from "react";

import { BackgroundAdjust, BackgroundGrid, FILL_FAMILIES, familyOf } from "./background-picker";
import { PALETTE } from "./card-chart";
import { useCardTheme } from "./card-look";
import ColourField from "./colour-field";
import { certificateRemedy, useStudioAdmin } from "./connections";
import { IconField } from "./icon-chooser";
import StudioIcon from "./icons";
import { SIZE_CLASSES, VALUE_BLOCKS, allBlocks, blocksOf, exactColour, setOverride } from "./look.mjs";
import { BLOCK_NAMES, SIZE_NAMES, SizeBar, scoped } from "./show-editor";
import ShowOn from "./show-on";
import { Group, Row, Segmented, Select, Switch } from "./ui";

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
// A saved look is the widget's style; what it shows (its values, blocks and
// size layouts) stays with the widget when a look is applied or saved.
export const CONTENT_KEYS = Object.freeze(["values", "blocks", "sizes", "arrange"]);
export const lookOnly = (look = {}) =>
  Object.fromEntries(Object.entries(look).filter(([key]) => !CONTENT_KEYS.includes(key)));
export const contentOnly = (look = {}) =>
  Object.fromEntries(Object.entries(look).filter(([key]) => CONTENT_KEYS.includes(key)));
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
      info="Pick a saved look to use it on this widget; it changes the style, not what the widget shows. Save this widget's look to reuse it on others."
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
// The status address (T35, U8): empty means derived, from the widget's
// Connection or its link, shown greyed; typing one overrides it. Check now
// runs the card's own check on it before saving.
function StatusAddress({ check, address, switchWhere = "" }) {
  const id = useId();
  const [result, setResult] = useState(null);
  const admin = useStudioAdmin();
  const ping = check === "ping";
  const own = (ping ? address.ping : address.web) || "";
  const derived = address.fallback?.address || address.href || "";
  const from = address.fallback?.from || "link";
  const saved = /^\{\{STUDIO_CONNECTION_/.test(derived);
  let shown = derived;
  if (saved) shown = "The saved connection's address";
  else if (ping && derived) {
    try {
      shown = new URL(derived).hostname;
    } catch {
      shown = derived;
    }
  }
  const target = own || derived;
  const run = async () => {
    setResult({ busy: true });
    try {
      setResult(await address.onCheck(check, target));
    } catch (failure) {
      setResult({ ok: false, message: failure.message });
    }
  };
  return (
    <Row
      label="Address"
      htmlFor={id}
      info={
        ping
          ? "The host to ping. Left empty, it's the host of the widget's Connection address, or of its link."
          : "The address to check, often a health page. Left empty, it's the widget's Connection address, or its link."
      }
    >
      <div className="studio-status-address">
        <div className="studio-input-line">
          <input
            id={id}
            value={ping ? address.ping : address.web}
            inputMode={ping ? "text" : "url"}
            autoComplete="off"
            aria-describedby={`${id}-from`}
            placeholder={shown || (ping ? "host.example.org" : "https://service.example.org/health")}
            onChange={(event) => {
              setResult(null);
              address.onChange(check, event.target.value.trim());
            }}
          />
        </div>
        {/* Where an empty address comes from, right under the field; then
            Check now and its answer on one line (review L1). */}
        <span id={`${id}-from`} className="studio-muted studio-status-from">
          {own ? "Your own address" : derived ? `From the ${from}` : "Nothing to check yet"}
        </span>
        {address.onCheck && target && (
          <div className="studio-inline-actions studio-status-check">
            <button type="button" className="studio-button studio-quiet" disabled={result?.busy} onClick={run}>
              {result?.busy ? "Checking…" : "Check now"}
            </button>
            <p
              className={`studio-connection-result${result && !result.busy ? (result.ok ? " studio-ok" : " studio-failed") : ""}`}
              role="status"
            >
              {result && !result.busy
                ? result.kind === "certificate"
                  ? `${result.message}. ${certificateRemedy(admin, switchWhere)}`
                  : result.message
                : ""}
            </p>
          </div>
        )}
      </div>
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

// Each value's own name, number style, chart colour and colour rules. Which
// block shows a value, and in what order, is set in Show; these follow the
// value into every block. Rows come back in the widget's order.
export function arrangeValues(fields, values = []) {
  const byField = new Map(values.map((value) => [value.field, value]));
  return fields.map(({ field, label }) => {
    const stored = byField.get(field) || {};
    return {
      field,
      label: label || field,
      format: stored.format,
      name: stored.label,
      colour: stored.colour,
      rules: stored.rules,
    };
  });
}

// What a widget stores (Rule 2): only the values with a change, each with
// only what changed; nothing when none has one. A value the widget isn't
// drawing right now keeps its settings for when it comes back.
export function storedValues(rows, values = []) {
  const listed = new Set(rows.map((row) => row.field));
  const stored = [
    ...values.filter((value) => !listed.has(value.field)),
    ...rows
      .map(({ field, format, name, colour, rules }) => ({
        field,
        ...(name && name.trim() ? { label: name.trim() } : {}),
        ...(format && format !== "full" ? { format } : {}),
        ...(colour ? { colour } : {}),
        ...(rules ? { rules } : {}),
      }))
      .filter((entry) => Object.keys(entry).length > 1),
  ];
  return stored.length ? stored : undefined;
}

const FORMAT_CHOICES = [
  ["full", "1,234,567"],
  ["short", "1.2M"],
  ["compact", "1.2 M"],
];

// numbers: the values Studio collects as numbers, in the collector's order,
// which sets each one's chart colour unless it has its own (card-chart
// chartSeries). Picking that colour again stores nothing (Rule 2).
function ValueStyles({ fields, values = [], numbers = [], onChange }) {
  const { t } = useTranslation();
  const rows = arrangeValues(fields, values).map((row) => ({ ...row, label: t(row.label) }));
  const [rulesOpen, setRulesOpen] = useState(null);
  const defaultColour = new Map(numbers.map((key, position) => [key, PALETTE[position % PALETTE.length]]));
  const update = (index, patch) =>
    onChange(
      storedValues(
        rows.map((row, position) => (position === index ? { ...row, ...patch } : row)),
        values,
      ),
    );
  if (!rows.length)
    return <p className="studio-note">The values show here once the widget has read them. Save, then come back.</p>;
  return (
    <ol className="studio-value-list studio-value-styles">
      {rows.map((row, index) => (
        <li key={row.field}>
          <input
            aria-label={`Name shown for ${row.label}`}
            value={row.name || ""}
            placeholder={row.label}
            maxLength={40}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <Select
            className="studio-value-format"
            label={`Number style for ${row.label}`}
            value={row.format || "full"}
            options={FORMAT_CHOICES}
            onChange={(format) => update(index, { format })}
          />
          {defaultColour.has(row.field) ? (
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
          )}
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
      ))}
    </ol>
  );
}

// The Look, Status and Behaviour parts of the widget editor, and every part
// at once for several widgets. `look` and `behaviour` are the widget's own
// sparse overrides; `inherited*` is what it gets from the dashboard. Every
// change goes through setOverride, so a value equal to the dashboard's
// removes the key (Rule 2).
// Whether the value styles part has anything to show.
export function valuesPartShown({ show, fields = [] }) {
  return Boolean(show.values && fields.length > 0);
}

const FILL_LABELS = { plain: "Plain", tint: "Tint", solid: "Solid", picture: "Picture", pattern: "Pattern" };
const EDGE_LABELS = { line: "line", shadow: "shadow", both: "line and shadow", none: "no edge" };
const CORNER_LABELS = { square: "square", default: "default corners", round: "round" };
const CHECK_LABELS = { web: "Web address", ping: "Ping", off: "No status check" };
const CLICK_LABELS = { same: "opens link", new: "opens in a new tab", none: "no click" };

// The one-line summaries of each part, so what a widget is set to reads
// without opening anything.
export function lookSummaries({ kind, look = {}, behaviour = {}, inheritedLook, inheritedBehaviour, savedLooks = [] }) {
  const show = lookSections(kind);
  const effective = { ...inheritedLook, ...look };
  const acts = { ...inheritedBehaviour, ...behaviour };
  const own = lookOnly(look);
  const saved = Object.keys(own).length ? savedLooks.find((entry) => sameLook(entry.look, own)) : null;
  const shape = [FILL_LABELS[effective.fill], CORNER_LABELS[effective.corners], EDGE_LABELS[effective.edge]]
    .filter(Boolean)
    .join(", ");
  const blocks = blocksOf(effective).filter((block) => show.values || !VALUE_BLOCKS.includes(block.type));
  const sized = SIZE_CLASSES.filter((key) => effective.sizes?.[key] && Object.keys(effective.sizes[key]).length);
  const showing = [
    blocks.map((block) => BLOCK_NAMES[block.type]).join(", ") || "Header only",
    sized.length ? `own layout at ${sized.map((key) => SIZE_NAMES[key]).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
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
  // An integration widget's Docker container ({ server, container, onChange }),
  // kept on the entry around it like its logo (6a93f66 had it on that entry's
  // own tile).
  docker,
  // { skip, onChange }: the per-service exception to certificate checking (D1).
  certificate,
  // An integration widget's own logo and description ({ icon, description,
  // onIcon, onDescription }), shown with the header that draws them.
  identity,
  chartFields,
  // The size being set up ("all" or a size class, shared with Show) and the
  // live card's last fit (Auto says what it picked). Several widgets edited
  // together have no sizes of their own to pick.
  scope = "all",
  onScope,
  fit,
}) {
  const show = sections || lookSections(kind);
  const showId = useId();
  // The widget editor shows each part in its own tab: look, values (number
  // styles under Show), status (Behaviour) and page. "all" shows every part
  // at once (several widgets edited together).
  const inPart = (name) => part === "all" || part === name;
  const sectioned = part !== "all";
  const effective = { ...inheritedLook, ...look };
  const acts = { ...inheritedBehaviour, ...behaviour };
  const setLook = (key, value) => onLook(setOverride(look, key, value, inheritedLook));
  const setBehaviour = (key, value) => onBehaviour(setOverride(behaviour, key, value, inheritedBehaviour));
  // Header, text and alignment can differ by size (mock-ups v4, board 1).
  const sized = scoped(look, inheritedLook, onScope ? scope : "all");
  const ownTag = (key) => (sized.ownKey(key) ? <span className="studio-own-tag">this size</span> : null);
  const sizedChoice = (key, label, options, info) => (
    <Row label={label} info={info}>
      {ownTag(key)}
      <MixedNote value={sized.read(key)} />
      <Segmented
        label={label}
        value={sized.read(key)}
        options={options}
        onChange={(value) => onLook(sized.write(key, value))}
      />
    </Row>
  );
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
  const header = sized.read("header");
  const named = header === "logo-name" || header === "name" || header === MIXED;
  const logoShown = header === "logo-name" || header === "logo" || header === MIXED;
  const textMode = sized.read("text");
  const headerNow = fit?.pick && sized.read("headerAt") === "auto" ? (fit.pick.inline ? "beside" : "on top") : null;
  const scaleNow = fit && textMode === "scale" && Number.isFinite(fit.scale) ? Math.round(fit.scale * 100) : null;
  return (
    <div className="studio-look-editor">
      {inPart("look") && onScope && (
        <SizeBar
          look={look}
          scope={scope}
          onScope={onScope}
          now={fit?.sizeClass}
          onUseAll={() => {
            const sizes = { ...(look.sizes || {}) };
            delete sizes[scope];
            onLook(setOverride(look, "sizes", Object.keys(sizes).length ? sizes : undefined, inheritedLook));
          }}
        />
      )}
      {inPart("look") && show.logo && (
        <Group title="Header" className="studio-look-header" key="header">
          <div data-key="header">
            {sizedChoice("header", "Header", [
              ["logo-name", "Logo and name"],
              ["logo", "Logo"],
              ["name", "Name"],
              ["hidden", "None"],
            ])}
          </div>
          {identity && logoShown && (
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
          {logoShown && (
            <Dependent>
              {sizedChoice("logoPos", "Logo position", [
                ["left", "Left"],
                ["above", header === "logo-name" ? "Centred, above" : "Centred"],
              ])}
            </Dependent>
          )}
          {header !== "hidden" && (
            <Dependent>
              {sizedChoice(
                "headerAt",
                "Header sits",
                [
                  [
                    "auto",
                    headerNow ? (
                      <>
                        Auto <span className="studio-auto-now">· {headerNow}</span>
                      </>
                    ) : (
                      "Auto"
                    ),
                  ],
                  ["top", "On top"],
                  ["left", "Beside"],
                ],
                "Auto puts the header beside the blocks only when the widget is much wider than tall.",
              )}
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
        </Group>
      )}
      {inPart("look") && (
        <Group title="Text" key="text">
          {sizedChoice(
            "text",
            "Text",
            [
              ["scale", "Scales"],
              ["fixed", "Fixed"],
            ],
            "Scales: text grows with the widget and shrinks down to the smallest size below, which sets how small the widget can be made. Fixed: text stays one size.",
          )}
          {scaleNow !== null && <p className="studio-row-note">Now at {scaleNow}%.</p>}
          {sizedChoice("textSize", textMode === "fixed" ? "Text size" : "Smallest text", [
            ["small", "Small"],
            ["medium", "Medium"],
            ["large", "Large"],
          ])}
          {sizedChoice("align", "Values line up", [
            ["centre", "Centred"],
            ["left", "Left"],
          ])}
          {show.values && (
            <Choice
              label="Numbers font"
              value={effective.numbers}
              onChange={(value) => setLook("numbers", value)}
              options={[
                ["sans", "Regular"],
                ["mono", "Monospaced"],
              ]}
            />
          )}
        </Group>
      )}
      {inPart("look") && (
        <Group title={sectioned ? "Style" : "Look"} key="style">
          {onScope && scope !== "all" && <p className="studio-row-note">Style is the same at every size.</p>}
          <SavedLooks
            saved={savedLooks}
            look={look}
            onChange={onSavedLooks}
            personal={personalLooks}
            usage={lookUsage}
            onUpdateUsers={onUpdateLookUsers}
            onApply={(saved) => onLook({ ...saved, ...contentOnly(look) })}
          />
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
        </Group>
      )}
      {inPart("status") && show.status && (
        <Group title="Status">
          <Choice
            label="Check by"
            value={acts.status}
            onChange={(value) => setBehaviour("status", value)}
            options={[
              ["web", "Web address"],
              ["ping", "Ping"],
              ["off", "Off"],
            ]}
            info="Web address checks the status address when one is set, otherwise the widget's Connection address or its link. Ping uses the same address's host. Status history and Response time blocks (Show) draw from this check."
          />
          {acts.status !== "off" && (
            <Dependent>
              {statusAddress && (
                <StatusAddress
                  check={acts.status}
                  address={statusAddress}
                  switchWhere={certificate ? " below" : " in Connection"}
                />
              )}
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
            </Dependent>
          )}
          {acts.status === "off" && statusBlocks(effective).length > 0 && (
            <p className="studio-callout studio-callout-warn" role="status">
              {statusBlocks(effective)
                .map((type) => BLOCK_NAMES[type])
                .join(" and ")}{" "}
              in Show need{statusBlocks(effective).length > 1 ? "" : "s"} this check, so{" "}
              {statusBlocks(effective).length > 1 ? "they stay" : "it stays"} empty while it is off.
            </p>
          )}
          {docker && (
            <>
              <Row
                label="Docker server"
                htmlFor={`${showId}-docker-server`}
                info="The Docker server's name from docker.yaml. With a container, the card shows whether it is running."
              >
                <input
                  id={`${showId}-docker-server`}
                  type="text"
                  value={docker.server || ""}
                  onChange={(event) => docker.onChange("server", event.target.value)}
                  placeholder={docker.servers?.[0] || "my-docker"}
                  maxLength={200}
                  autoComplete="off"
                  list={docker.servers?.length ? `${showId}-docker-servers` : undefined}
                />
                {/* docker.yaml's servers as choices; any name can still be typed (review L2). */}
                {docker.servers?.length > 0 && (
                  <datalist id={`${showId}-docker-servers`}>
                    {docker.servers.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                )}
              </Row>
              <Row label="Docker container" htmlFor={`${showId}-docker-container`}>
                <input
                  id={`${showId}-docker-container`}
                  type="text"
                  value={docker.container || ""}
                  onChange={(event) => docker.onChange("container", event.target.value)}
                  placeholder="container name"
                  maxLength={200}
                  autoComplete="off"
                />
              </Row>
            </>
          )}
          {/* A plain tile's switch: only with a web check, the one it affects. */}
          {certificate && acts.status === "web" && (
            <Row
              label="Check its certificate"
              info="Studio checks the certificate of this service's address, for its data, Test connection and status check, against the usual public authorities and Administration › Trusted certificates. Turn it off only for a service whose self-signed certificate can’t be added there."
            >
              <Switch
                checked={!certificate.skip}
                label="Check its certificate"
                onChange={(checked) => certificate.onChange(!checked)}
              />
            </Row>
          )}
          {certificate?.skip && acts.status === "web" && (
            <p className="studio-certificate-note" role="note">
              Studio accepts any certificate from this address, so it can’t tell the real service from an impostor.
            </p>
          )}
        </Group>
      )}
      {inPart("values") && valuesPartShown({ show, fields }) && (
        <Group
          title="Each value"
          info="A value's name, number style, chart colour and colour rules follow it into every block that shows it."
        >
          <ValueStyles
            fields={fields}
            values={look.values || []}
            numbers={(Array.isArray(chartFields) ? chartFields : []).map((field) => field.field)}
            onChange={(values) => setLook("values", values)}
          />
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
          <Row
            label="Show on"
            info="The layouts this widget appears on. While editing, a layout shows the widgets it leaves out faded, so you can turn them back on."
          >
            <MixedNote value={acts.showOn} />
            <ShowOn value={acts.showOn} onChange={(value) => setBehaviour("showOn", value)} />
          </Row>
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
          <Row label="Page">
            <Select
              id="studio-widget-page"
              label="Page"
              value={pageId}
              options={pages.map((page) => [page.id, page.name])}
              onChange={onPage}
            />
          </Row>
        </Group>
      )}
    </div>
  );
}

// The status blocks a look shows at any size, which need the status check.
function statusBlocks(look) {
  return [...new Set(allBlocks(look).map((block) => block.type))].filter(
    (type) => type === "status" || type === "response",
  );
}

function hexOr(...candidates) {
  return candidates.find((value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) || "#b299be";
}
