import { useId, useState } from "react";

import { BackgroundAdjust, BackgroundGrid, familyOf, FILL_FAMILIES } from "./background-picker";
import { useCardTheme } from "./card-look";
import StudioIcon from "./icons";
import { setOverride } from "./look.mjs";
import { Group, Row, Segmented } from "./ui";

// Which parts of the widget dialog apply to each kind of widget (Rule 1: only
// show options that can apply).
const HAS_LOGO = new Set(["service", "serviceWidget", "bookmark"]);
const HAS_STATUS = new Set(["service", "serviceWidget"]);
const HAS_VALUES = new Set(["serviceWidget"]);
const HAS_LINK = new Set(["service", "serviceWidget", "bookmark"]);

export function lookSections(kind) {
  return {
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
    };
  });
}

// What a widget stores (Rule 2): nothing while the rows are the widget's own
// order with nothing changed; otherwise every row in order, each with only
// the settings that differ from the widget's own.
export function storedValues(rows, fields) {
  const natural = fields.map((field) => field.field);
  const reordered = rows.some((row, index) => row.field !== natural[index]);
  const stored = rows.map(({ field, slot, format, name }) => ({
    field,
    ...(slot && slot !== "below" ? { slot } : {}),
    ...(name && name.trim() ? { label: name.trim() } : {}),
    ...(format && format !== "full" ? { format } : {}),
  }));
  if (!reordered && stored.every((entry) => Object.keys(entry).length === 1)) return undefined;
  return stored;
}

function ValueList({ fields, values, layout, onChange }) {
  const rows = arrangeValues(fields, values);
  const commit = (next) => onChange(storedValues(next, fields));
  const update = (index, patch) => {
    const next = rows.map((row, position) => {
      if (position === index) return { ...row, ...patch };
      // One hero at a time: choosing a new one returns the old one below.
      if (patch.slot === "hero" && row.slot === "hero") return { ...row, slot: undefined };
      return row;
    });
    commit(next);
  };
  const move = (index, step) => {
    const next = [...rows];
    const [entry] = next.splice(index, 1);
    next.splice(index + step, 0, entry);
    commit(next);
  };
  const slots =
    layout === "hero"
      ? [
          ["hero", "Hero"],
          ["below", "Below"],
          ["hidden", "Hidden"],
        ]
      : [
          ["below", "Shown"],
          ["hidden", "Hidden"],
        ];
  return (
    <ol className="studio-value-list">
      {rows.map((row, index) => {
        const slot = row.slot === "hero" && layout !== "hero" ? "below" : row.slot || "below";
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
}) {
  const show = sections || lookSections(kind);
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
          {show.values && (
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
                    <input
                      type="color"
                      aria-label="Card colour"
                      className="studio-colour-input"
                      value={effective.colour}
                      onChange={(event) => setLook("colour", event.target.value)}
                    />
                  )}
                </div>
              </Row>
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
            onChange={(value) => setBehaviour("status", value)}
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
                label="Show as"
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
        </Group>
      )}
      {bottom && show.values && fields.length > 0 && (
        <Group
          title="Show"
          info="The values this widget showed last. Pick the hero, hide what you don't need, rename a value or change how its number reads."
        >
          <ValueList
            fields={fields}
            values={look.values || []}
            layout={effective.layout}
            onChange={(values) => setLook("values", values)}
          />
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
