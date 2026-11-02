import { useContext, useState } from "react";

import { resolvedBehaviour, resolvedLook } from "./card-look";
import { COLUMNS } from "./geometry.mjs";
import LookEditor, { MIXED, sharedSections } from "./look-editor";
import { setOverride } from "./look.mjs";
import { Group, Row } from "./ui";

import { SettingsContext } from "utils/contexts/settings";

// "1 widget", "3 widgets".
export const widgetCount = (count) => `${count} widget${count === 1 ? "" : "s"}`;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What several widgets have in common: a setting they share shows its value,
// one where they differ shows MIXED.
export function commonValues(values) {
  const keys = new Set(values.flatMap((value) => Object.keys(value)));
  const out = {};
  for (const key of keys) {
    const first = values[0][key];
    out[key] = values.every((value) => same(value[key], first)) ? first : MIXED;
  }
  return out;
}

// The settings a change in the editor touched, as effective values.
function changedKeys(next, shown, inherited) {
  const out = {};
  for (const key of new Set([...Object.keys(next), ...Object.keys(shown)])) {
    const value = key in next ? next[key] : inherited[key];
    if (value !== MIXED && !same(value, shown[key])) out[key] = value;
  }
  return out;
}

// Applies one change to every widget, keeping each override sparse (Rule 2).
export function applyChanges(panels, { look = {}, behaviour = {} }, inherited) {
  return panels.map((panel) => {
    let nextLook = panel.look || {};
    let nextBehaviour = panel.behaviour || {};
    for (const [key, value] of Object.entries(look)) nextLook = setOverride(nextLook, key, value, inherited.look);
    for (const [key, value] of Object.entries(behaviour))
      nextBehaviour = setOverride(nextBehaviour, key, value, inherited.behaviour);
    const { look: _look, behaviour: _behaviour, ...rest } = panel;
    return {
      ...rest,
      ...(Object.keys(nextLook).length ? { look: nextLook } : {}),
      ...(Object.keys(nextBehaviour).length ? { behaviour: nextBehaviour } : {}),
    };
  });
}

// Look and behaviour for several widgets at once. Only the sections every
// selected widget has are shown; a row where they differ says "Mixed" until
// a value is picked, and only what was changed is applied.
export function BulkLookEditor({ panels, savedLooks, onApply, onCancel }) {
  const settings = useContext(SettingsContext)?.settings;
  const inheritedLook = resolvedLook(settings, null);
  const inheritedBehaviour = resolvedBehaviour(settings, null);
  const shownLook = commonValues(panels.map((panel) => resolvedLook(settings, panel)));
  const shownBehaviour = commonValues(panels.map((panel) => resolvedBehaviour(settings, panel)));
  const [changes, setChanges] = useState({ look: {}, behaviour: {} });
  const look = { ...shownLook, ...changes.look };
  const behaviour = { ...shownBehaviour, ...changes.behaviour };
  const count = Object.keys(changes.look).length + Object.keys(changes.behaviour).length;
  return (
    <>
      <div className="studio-dialog-body">
        <p className="studio-note">
          Changes apply to all {panels.length} selected widgets. A row marked Mixed keeps each widget&apos;s own setting
          until you pick a value.
        </p>
        <LookEditor
          kind={panels[0].kind}
          sections={sharedSections(panels.map((panel) => panel.kind))}
          look={look}
          behaviour={behaviour}
          inheritedLook={inheritedLook}
          inheritedBehaviour={inheritedBehaviour}
          savedLooks={savedLooks}
          onLook={(next) =>
            setChanges((current) => ({
              ...current,
              look: { ...current.look, ...changedKeys(next, look, inheritedLook) },
            }))
          }
          onBehaviour={(next) =>
            setChanges((current) => ({
              ...current,
              behaviour: { ...current.behaviour, ...changedKeys(next, behaviour, inheritedBehaviour) },
            }))
          }
        />
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button type="button" className="studio-button studio-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="studio-button studio-primary"
          disabled={!count}
          onClick={() => onApply(changes, { look: inheritedLook, behaviour: inheritedBehaviour })}
        >
          Apply to {widgetCount(panels.length)}
        </button>
      </footer>
    </>
  );
}

// One width and height for several widgets, in grid columns and rows. A
// size they don't share starts empty ("Mixed") and is left alone.
export function BulkSizeEditor({ units, onApply, onCancel }) {
  const common = commonValues(units.map((unit) => ({ w: unit.rect.w, h: unit.rect.h })));
  const [w, setW] = useState(common.w === MIXED ? "" : String(common.w));
  const [h, setH] = useState(common.h === MIXED ? "" : String(common.h));
  const width = w === "" ? null : Number(w);
  const height = h === "" ? null : Number(h);
  const valid =
    (width === null || (Number.isInteger(width) && width >= 1 && width <= COLUMNS)) &&
    (height === null || (Number.isInteger(height) && height >= 1 && height <= 40));
  const changed = (width !== null && width !== common.w) || (height !== null && height !== common.h);
  return (
    <>
      <div className="studio-dialog-body">
        <Group>
          <Row
            label="Width"
            htmlFor="studio-bulk-width"
            info={`In grid columns, 1 to ${COLUMNS}. The page is ${COLUMNS} columns wide.`}
          >
            <input
              id="studio-bulk-width"
              type="number"
              inputMode="numeric"
              min={1}
              max={COLUMNS}
              placeholder={common.w === MIXED ? "Mixed" : undefined}
              value={w}
              onChange={(event) => setW(event.target.value)}
            />
          </Row>
          <Row
            label="Height"
            htmlFor="studio-bulk-height"
            info="In rows. A widget never gets smaller than its content needs."
          >
            <input
              id="studio-bulk-height"
              type="number"
              inputMode="numeric"
              min={1}
              max={40}
              placeholder={common.h === MIXED ? "Mixed" : undefined}
              value={h}
              onChange={(event) => setH(event.target.value)}
            />
          </Row>
        </Group>
        <p className="studio-note">Widgets below make room, as when you resize one by hand.</p>
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button type="button" className="studio-button studio-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="studio-button studio-primary"
          disabled={!valid || !changed}
          onClick={() => onApply({ w: width, h: height })}
        >
          Apply to {widgetCount(units.length)}
        </button>
      </footer>
    </>
  );
}

export function DeleteWidgetsConfirm({ count, discovered, onDelete, onCancel, pending }) {
  return (
    <div className="studio-dialog-body studio-discard-prompt">
      <p className="studio-note">
        This removes them from your configuration files
        {discovered ? `, and hides ${discovered} discovered widget${discovered === 1 ? "" : "s"}` : ""}. A snapshot is
        kept, so you can restore them from dashboard settings under Snapshots &amp; restore.
      </p>
      <div className="studio-inline-actions">
        <button type="button" className="studio-button studio-quiet" disabled={pending} onClick={onCancel}>
          Keep them
        </button>
        <button type="button" className="studio-button studio-danger" disabled={pending} onClick={onDelete}>
          Delete {widgetCount(count)}
        </button>
      </div>
    </div>
  );
}
