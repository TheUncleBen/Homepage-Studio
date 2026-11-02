import { useTranslation } from "next-i18next/pages";
import { useId, useState } from "react";

import { BackgroundAdjust, BackgroundGrid, familyOf, FILL_FAMILIES } from "./background-picker";
import { PALETTE, partsFormat } from "./card-chart";
import { useCardTheme } from "./card-look";
import ColourField from "./colour-field";
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
const lookOnly = (look = {}) => {
  const { values: _values, ...rest } = look;
  return rest;
};
const sameLook = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

// Named looks to reuse on other widgets: pick one to apply it, or save this
// widget's look under a name. Only shown when there is something to pick or
// something to save.
function SavedLooks({ saved = [], look, onApply, onChange }) {
  const [naming, setNaming] = useState(null);
  const current = lookOnly(look);
  const canSave =
    Boolean(onChange) && Object.keys(current).length > 0 && !saved.some((entry) => sameLook(entry.look, current));
  if (!saved.length && !canSave) return null;
  const name = (naming ?? "").trim();
  const taken = saved.some((entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  const save = () => {
    if (!name || taken || name.length > 40) return;
    const id = newLookId();
    onChange([...saved, { id, name, look: current }]);
    setNaming(null);
  };
  return (
    <Row
      label="Saved looks"
      stacked
      info="Name this look to reuse it on other widgets. Picking one replaces the look, not the widget's values."
    >
      <div className="studio-saved-looks">
        {saved.map((entry) => (
          <span key={entry.id} className="studio-saved-look">
            <button
              type="button"
              className="studio-chip"
              aria-pressed={sameLook(entry.look, current)}
              onClick={() => onApply(entry.look)}
            >
              {entry.name}
            </button>
            {onChange && (
              <button
                type="button"
                className="studio-chip-remove"
                aria-label={`Forget saved look ${entry.name}`}
                title="Forget this saved look"
                onClick={() => onChange(saved.filter((item) => item.id !== entry.id))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {canSave && naming === null && (
          <button type="button" className="studio-chip studio-chip-add" onClick={() => setNaming("")}>
            + Save this look
          </button>
        )}
      </div>
      {naming !== null && (
        <div className="studio-saved-look-name">
          <input
            aria-label="Name for this look"
            placeholder="For example Night"
            maxLength={40}
            value={naming}
            autoFocus
            onChange={(event) => setNaming(event.target.value)}
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
          <button type="button" className="studio-button studio-quiet" onClick={() => setNaming(null)}>
            Cancel
          </button>
          <button type="button" className="studio-button studio-primary" disabled={!name || taken} onClick={save}>
            Save
          </button>
          {taken && <span className="studio-field-error">That name is taken.</span>}
        </div>
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

function ValueList({ fields, values, layout, show = "numbers", formats = {}, onChange }) {
  const { t } = useTranslation();
  // Widgets name their values with translation keys (adguard.queries).
  const rows = arrangeValues(fields, values).map((row) => ({ ...row, label: t(row.label) }));
  const [rulesOpen, setRulesOpen] = useState(null);
  // Donut and pie draw only the values in one format (card-chart partsFormat).
  const partsUnit =
    (show === "donut" || show === "pie") && Object.keys(formats).length
      ? partsFormat(Object.entries(formats).map(([field, format]) => ({ field, format })))
      : null;
  const coloured = ["line", "area", "bar", "donut", "pie"].includes(show);
  const commit = (next) => onChange(storedValues(next, fields));
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
  const slots = heroed
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
    if (index === hero) return "hero";
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
        if (partsUnit && (formats[row.field] || "plain") !== partsUnit) return null;
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
            <select
              aria-label={`Where ${row.label} shows`}
              value={slot}
              onChange={(event) => update(index, { slot: event.target.value })}
            >
              {slots.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
            <select
              aria-label={`Number style for ${row.label}`}
              value={row.format || "full"}
              onChange={(event) => update(index, { format: event.target.value })}
            >
              <option value="full">1,234,567</option>
              <option value="short">1.2M</option>
              <option value="compact">1.2 M</option>
            </select>
            {coloured && slot !== "hidden" && (row.colour || defaultColour.has(row.field)) && (
              <ColourField
                label={`Chart colour for ${row.label}`}
                value={row.colour || defaultColour.get(row.field)}
                onChange={(colour) =>
                  update(index, { colour: colour === defaultColour.get(row.field) ? undefined : colour })
                }
              />
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
        );
      })}
    </ol>
  );
}

// The Look, Status, Show and Behaviour sections of the widget dialog. `look`
// and `behaviour` are the widget's own sparse overrides; `inherited*` is what
// it gets from the dashboard. Every change goes through setOverride, so a
// value equal to the dashboard's removes the key (Rule 2).
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
  statusAddress,
  chartFields,
  // The time ranges the dashboard keeps history for (card-chart chartRanges).
  rangeChoices = ["1h", "6h", "24h", "7d", "30d"],
}) {
  const show = sections || lookSections(kind);
  const showId = useId();
  // The dialog puts Look and Status above the widget's own settings, and
  // Show and Behaviour below them, as in the approved layout.
  const top = part !== "bottom";
  const bottom = part !== "top";
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
      {top && (
        <Group title="Look">
          <SavedLooks
            saved={savedLooks}
            look={look}
            onChange={onSavedLooks}
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
                  {/* A trend needs a number the collector can keep (Rule 1). */}
                  {show.charts &&
                    effective.show === "numbers" &&
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
      {top && show.status && (
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
            info="Web address asks the service's site monitor, or its address when it has none. Ping uses its ping host, or the address's host."
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
      {bottom && show.values && (fields.length > 0 || effective.show === "status") && (
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
            />
          )}
        </Group>
      )}
      {bottom && (
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
          {pages.length > 1 && onPage && (
            <Row label="Page" htmlFor="studio-widget-page">
              <select id="studio-widget-page" value={pageId} onChange={(event) => onPage(event.target.value)}>
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.name}
                  </option>
                ))}
              </select>
            </Row>
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
    </div>
  );
}

function hexOr(...candidates) {
  return candidates.find((value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) || "#b299be";
}
