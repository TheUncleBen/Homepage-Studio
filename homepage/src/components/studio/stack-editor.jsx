import { useEffect, useId, useState } from "react";

import { useEditorDraft } from "./draft-guard";
import { COLUMNS, moveUnit, unitMinimum, unstackBoard } from "./geometry.mjs";
import StudioIcon from "./icons";
import { ActionRow, Group, Row, Segmented, Switch } from "./ui";

const POSITION_FIELDS = [
  ["x", "Column", 0, COLUMNS - 1],
  ["y", "Row", 0, 100000],
  ["w", "Width", 1, COLUMNS],
  ["h", "Height", 1, 1000],
];

const positionText = (rect) => Object.fromEntries(POSITION_FIELDS.map(([key]) => [key, String(rect[key])]));

// Validate the raw text of every field without rewriting any of them. Content
// minimums are not errors here: blur raises a field to its minimum and the
// shared geometry enforces it on Apply, so older saved sizes still apply.
export function validatePosition(text) {
  const rect = {};
  for (const [key, label, min, max] of POSITION_FIELDS) {
    const raw = String(text[key] ?? "").trim();
    if (!raw) return { field: key, error: `Enter a ${label.toLowerCase()}.` };
    if (!/^\d+$/.test(raw)) return { field: key, error: `${label} must be a whole number.` };
    const value = Number(raw);
    if (value < min || value > max)
      return {
        field: key,
        error: `${label} must be between ${min} and ${max}.`,
      };
    rect[key] = value;
  }
  if (rect.x + rect.w > COLUMNS)
    return {
      field: "x",
      error: `Column plus width cannot exceed ${COLUMNS}. Lower the column or the width.`,
    };
  return { rect, field: null, error: null };
}

// Slideshow timing fields, shown in display units (seconds or milliseconds)
// and stored in milliseconds. Seconds keep fractional values so existing
// timings such as 2.5 seconds still round-trip.
const PLAYBACK_FIELDS = [
  {
    key: "intervalMs",
    id: "studio-stack-interval",
    label: "Seconds per widget",
    name: "seconds per widget",
    scale: 1000,
    min: 1,
    max: 3600,
    step: "any",
    decimals: true,
  },
  {
    key: "manualHoldMs",
    id: "studio-stack-manual-delay",
    label: "Manual navigation delay (seconds)",
    name: "manual navigation delay",
    scale: 1000,
    min: 1,
    max: 3600,
    step: "any",
    decimals: true,
  },
  {
    key: "transitionDurationMs",
    id: "studio-stack-duration",
    label: "Animation duration (ms)",
    name: "animation duration",
    scale: 1,
    min: 0,
    max: 2000,
    step: 10,
    decimals: false,
  },
];

const playbackText = (playback) =>
  Object.fromEntries(PLAYBACK_FIELDS.map(({ key, scale }) => [key, String(playback[key] / scale)]));

const numberPattern = (decimals) => (decimals ? /^\d+(\.\d+)?$/ : /^\d+$/);

// Validate one raw slideshow field without touching the others. Returns the
// stored millisecond value when valid, or a message describing the problem.
export function validatePlaybackField(key, raw) {
  const field = PLAYBACK_FIELDS.find((item) => item.key === key);
  const value = String(raw ?? "").trim();
  const label = field.name[0].toUpperCase() + field.name.slice(1);
  if (!value) return { error: `Enter the ${field.name}.` };
  if (!numberPattern(field.decimals).test(value))
    return {
      error: field.decimals
        ? `${label} must be a number of seconds.`
        : `${label} must be a whole number of milliseconds.`,
    };
  const number = Number(value);
  if (number < field.min || number > field.max)
    return {
      error: `${label} must be between ${field.min} and ${field.max}${field.scale === 1000 ? " seconds" : " milliseconds"}.`,
    };
  return { value: Math.round(number * field.scale), error: null };
}

// Column, row, width and height as one group of rows. The raw text of each
// field is kept while typing; only a valid set reaches onChange.
export function PositionFields({
  rect,
  onChange,
  onValidityChange,
  minimum = { w: 1, h: 1 },
  title = "Size and position",
}) {
  const [text, setText] = useState(() => positionText(rect));
  const errorId = useId();
  const idBase = useId();
  const { error, field } = validatePosition(text);
  useEffect(() => {
    onValidityChange?.(error);
  }, [error, onValidityChange]);
  const update = (next) => {
    setText(next);
    const result = validatePosition(next);
    if (!result.error) onChange({ ...rect, ...result.rect });
  };
  const needs =
    minimum.w > 1 || minimum.h > 1 ? ` This content needs at least ${minimum.w} columns and ${minimum.h} rows.` : "";
  return (
    <Group
      title={title}
      className="studio-position-fields"
      info={`Positions on the ${COLUMNS}-column layout; columns and rows start at 0. Nearby widgets move down when needed.${needs}`}
    >
      {POSITION_FIELDS.map(([key, label, absoluteMin, max]) => {
        const min = Math.max(absoluteMin, minimum[key] ?? absoluteMin);
        const id = `${idBase}-${key}`;
        return (
          <Row key={key} label={label} htmlFor={id} className={field === key ? "studio-row-invalid" : ""}>
            <input
              id={id}
              aria-invalid={field === key ? true : undefined}
              aria-describedby={field === key ? errorId : undefined}
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              step={1}
              value={text[key]}
              onChange={(event) => update({ ...text, [key]: event.target.value })}
              onBlur={() => {
                const raw = String(text[key]).trim();
                if (!/^\d+$/.test(raw)) return;
                const value = String(Math.max(min, Math.min(max, Number(raw))));
                if (value !== raw) update({ ...text, [key]: value });
              }}
            />
          </Row>
        );
      })}
      {error && (
        <p className="studio-field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </Group>
  );
}

function BlockedNote() {
  return (
    <p className="studio-callout studio-callout-warn" role="status">
      Dashboard data is updating. Your draft is still here. Keep it open, or close this editor to review the dashboard
      status.
    </p>
  );
}

export function PositionEditor({ unit, onApply, onClose, blocked = false }) {
  const [rect, setRect] = useState(unit.rect);
  const [invalid, setInvalid] = useState(null);
  useEditorDraft(Boolean(invalid) || JSON.stringify(rect) !== JSON.stringify(unit.rect));
  return (
    <>
      <div className="studio-dialog-body">
        {blocked && <BlockedNote />}
        <PositionFields rect={rect} onChange={setRect} onValidityChange={setInvalid} minimum={unit.minimum} />
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button className="studio-button studio-quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          className="studio-button studio-primary"
          disabled={blocked || Boolean(invalid)}
          onClick={() => onApply(rect)}
        >
          Apply to arrangement
        </button>
      </footer>
    </>
  );
}

const TRANSITIONS = [
  ["horizontal", "Horizontal"],
  ["vertical", "Vertical"],
  ["fade", "Fade"],
  ["none", "None"],
];

export default function StackEditor({ stack, board, onApply, onClose, onPanelEdit, fitting = false, blocked = false }) {
  const [draft, setDraft] = useState(() => structuredClone(stack));
  const [movedOut, setMovedOut] = useState([]);
  const [adding, setAdding] = useState(false);
  const [invalid, setInvalid] = useState(null);
  const [timingText, setTimingText] = useState(() => playbackText(stack.playback));
  const timingErrors = Object.fromEntries(
    PLAYBACK_FIELDS.map(({ key }) => [key, validatePlaybackField(key, timingText[key]).error]),
  );
  const timingInvalid = Object.values(timingErrors).some(Boolean);
  useEditorDraft(Boolean(invalid) || timingInvalid || JSON.stringify(draft) !== JSON.stringify(stack));
  const occupied = new Set(board.stacks.filter((item) => item.id !== stack.id).flatMap((item) => item.panelIds));
  const candidates = board.panels.filter((panel) => !draft.panelIds.includes(panel.id) && !occupied.has(panel.id));
  const updatePlayback = (key, value) =>
    setDraft((current) => ({
      ...current,
      playback: { ...current.playback, [key]: value },
    }));
  // Keep the raw text while typing; only a valid value reaches the draft, and
  // range clamping waits for blur so no keystroke rewrites the field.
  const updateTiming = (key, raw) => {
    setTimingText((current) => ({ ...current, [key]: raw }));
    const result = validatePlaybackField(key, raw);
    if (!result.error) updatePlayback(key, result.value);
  };
  const clampTiming = (key) => {
    const field = PLAYBACK_FIELDS.find((item) => item.key === key);
    const raw = String(timingText[key]).trim();
    if (!numberPattern(field.decimals).test(raw)) return;
    const value = String(Math.max(field.min, Math.min(field.max, Number(raw))));
    if (value !== raw) updateTiming(key, value);
  };
  const timingRow = ({ key, id, label, min, max, step }, info) => (
    <Row key={key} label={label} htmlFor={id} info={info} className={timingErrors[key] ? "studio-row-invalid" : ""}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        aria-invalid={timingErrors[key] ? true : undefined}
        aria-describedby={timingErrors[key] ? `${id}-error` : undefined}
        value={timingText[key]}
        onChange={(event) => updateTiming(key, event.target.value)}
        onBlur={() => clampTiming(key)}
      />
      {timingErrors[key] && (
        <p className="studio-field-error" id={`${id}-error`} role="alert">
          {timingErrors[key]}
        </p>
      )}
    </Row>
  );
  const reorder = (id, offset) => {
    const ids = [...draft.panelIds];
    const index = ids.indexOf(id);
    const other = index + offset;
    if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other], ids[index]];
    setDraft({ ...draft, panelIds: ids });
  };
  const apply = () => {
    let next = {
      ...board,
      stacks:
        draft.panelIds.length >= 2
          ? board.stacks.map((item) => (item.id === stack.id ? draft : item))
          : board.stacks.filter((item) => item.id !== stack.id),
    };
    if (draft.panelIds.length >= 2) next = moveUnit(next, stack.id, draft.rect);
    const returned = [...movedOut, ...(draft.panelIds.length < 2 ? draft.panelIds : [])];
    returned.forEach((id) => {
      const panel = next.panels.find((item) => item.id === id);
      if (panel) next = moveUnit(next, id, panel.rect);
    });
    onApply(next);
  };
  const manualWait = Math.max(draft.playback.intervalMs, draft.playback.manualHoldMs) / 1000;
  return (
    <>
      <div className="studio-dialog-body">
        {blocked && <BlockedNote />}
        {fitting && (
          <p className="studio-callout studio-callout-warn" role="status">
            These widgets have different sizes. They will all be {draft.rect.w} × {draft.rect.h}.
          </p>
        )}
        <Group
          title="Widgets"
          aside={`${draft.panelIds.length} in this stack`}
          info="Every widget in a stack shares one size. A widget you move out keeps its settings and goes back to its own size."
          className="studio-stack-members"
        >
          {draft.panelIds.map((id, index) => {
            const panel = board.panels.find((item) => item.id === id);
            return (
              <div className="studio-choice studio-choice-on studio-stack-member" key={id}>
                <span className="studio-choice-order" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="studio-choice-label studio-member-title">
                  <span>{panel?.title}</span>
                  <small>
                    {panel?.group}
                    {fitting && (
                      <>
                        {" "}
                        · {panel?.rect.w} × {panel?.rect.h} → {draft.rect.w} × {draft.rect.h}
                      </>
                    )}
                  </small>
                </span>
                <span className="studio-choice-move">
                  <button
                    type="button"
                    disabled={index === 0}
                    aria-label={`Move ${panel?.title} earlier in stack`}
                    onClick={() => reorder(id, -1)}
                  >
                    <StudioIcon name="up" size={15} />
                  </button>
                  <button
                    type="button"
                    disabled={index === draft.panelIds.length - 1}
                    aria-label={`Move ${panel?.title} later in stack`}
                    onClick={() => reorder(id, 1)}
                  >
                    <StudioIcon name="down" size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onPanelEdit(panel)}
                    disabled={fitting || blocked}
                    aria-label={`Configure ${panel?.title}`}
                  >
                    <StudioIcon name="edit" size={15} />
                  </button>
                  <button
                    type="button"
                    className="studio-member-remove"
                    onClick={() => {
                      setDraft({
                        ...draft,
                        panelIds: draft.panelIds.filter((item) => item !== id),
                      });
                      setMovedOut([...movedOut, id]);
                    }}
                    aria-label={`Move out ${panel?.title} from stack`}
                  >
                    <StudioIcon name="close" size={15} />
                  </button>
                </span>
              </div>
            );
          })}
          <ActionRow icon="plus" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            Add existing panel
          </ActionRow>
          {adding &&
            candidates.map((panel) => (
              <ActionRow
                key={panel.id}
                detail={`${panel.rect.w} × ${panel.rect.h} → ${draft.rect.w} × ${draft.rect.h}`}
                onClick={() => {
                  setDraft({
                    ...draft,
                    panelIds: [...draft.panelIds, panel.id],
                  });
                  setMovedOut(movedOut.filter((id) => id !== panel.id));
                  setAdding(false);
                }}
              >
                {panel.title}
              </ActionRow>
            ))}
          {adding && !candidates.length && (
            <p className="studio-empty-row">Every widget on this dashboard is already in a stack.</p>
          )}
        </Group>
        <PositionFields
          rect={draft.rect}
          minimum={unitMinimum(
            {
              ...board,
              stacks: board.stacks.map((item) => (item.id === stack.id ? draft : item)),
            },
            stack.id,
          )}
          onChange={(rect) => setDraft((current) => ({ ...current, rect }))}
          onValidityChange={setInvalid}
        />
        <Group
          title="Slideshow"
          info="The timer pauses while the tab is hidden, the stack is off screen, you are editing, or you are using a widget inside it. With reduced motion turned on, the stack doesn't start by itself or animate; Play still works."
        >
          <Row label="Start behavior" info="Manual waits for Play. Automatic starts by itself.">
            <Segmented
              label="Start behavior"
              value={draft.playback.mode}
              onChange={(value) => updatePlayback("mode", value)}
              options={[
                ["manual", "Manual"],
                ["automatic", "Automatic"],
              ]}
            />
          </Row>
          {timingRow(PLAYBACK_FIELDS[0])}
          {timingRow(
            PLAYBACK_FIELDS[1],
            `Switching widgets by hand while the stack plays waits ${manualWait} seconds, then the normal timing resumes. A paused stack stays paused.`,
          )}
          <Row label="Transition" stacked>
            <Segmented
              label="Transition"
              value={draft.playback.transition}
              onChange={(value) => updatePlayback("transition", value)}
              options={TRANSITIONS}
            />
          </Row>
          {timingRow(PLAYBACK_FIELDS[2])}
          <Row label="Loop after the last widget">
            <Switch
              label="Loop after the last widget"
              checked={draft.playback.loop}
              onChange={(value) => updatePlayback("loop", value)}
            />
          </Row>
        </Group>
        <Group className="studio-item-actions">
          <ActionRow icon="layout" danger disabled={blocked} onClick={() => onApply(unstackBoard(board, stack.id))}>
            Unstack all
          </ActionRow>
        </Group>
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button className="studio-button studio-quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          className="studio-button studio-primary"
          onClick={apply}
          disabled={blocked || Boolean(invalid) || timingInvalid}
        >
          Apply to arrangement
        </button>
      </footer>
    </>
  );
}
