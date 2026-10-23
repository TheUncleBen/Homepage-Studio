import { useEffect, useId, useState } from "react";

import { useEditorDraft } from "./draft-guard";
import { COLUMNS, moveUnit, unitMinimum, unstackBoard } from "./geometry.mjs";
import StudioIcon from "./icons";

const POSITION_FIELDS = [
  ["x", "Column", 0, COLUMNS - 1],
  ["y", "Row", 0, 100000],
  ["w", "Width", 1, COLUMNS],
  ["h", "Height", 1, 1000],
];

const positionText = (rect) =>
  Object.fromEntries(POSITION_FIELDS.map(([key]) => [key, String(rect[key])]));

// Validate the raw text of every field without rewriting any of them. Content
// minimums are not errors here: blur raises a field to its minimum and the
// shared geometry enforces it on Apply, so older saved sizes still apply.
export function validatePosition(text) {
  const rect = {};
  for (const [key, label, min, max] of POSITION_FIELDS) {
    const raw = String(text[key] ?? "").trim();
    if (!raw) return { field: key, error: `Enter a ${label.toLowerCase()}.` };
    if (!/^\d+$/.test(raw))
      return { field: key, error: `${label} must be a whole number.` };
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
  Object.fromEntries(
    PLAYBACK_FIELDS.map(({ key, scale }) => [
      key,
      String(playback[key] / scale),
    ]),
  );

const numberPattern = (decimals) => (decimals ? /^\d+(\.\d+)?$/ : /^\d+$/);

// Validate one raw slideshow field without touching the others. Returns the
// stored millisecond value when valid, or a message describing the problem.
export function validatePlaybackField(key, raw) {
  const field = PLAYBACK_FIELDS.find((item) => item.key === key);
  const value = String(raw ?? "").trim();
  const label = field.name[0].toUpperCase() + field.name.slice(1);
  if (!value) return { error: `Enter a ${field.name}.` };
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

export function PositionFields({
  rect,
  onChange,
  onValidityChange,
  minimum = { w: 1, h: 1 },
}) {
  const [text, setText] = useState(() => positionText(rect));
  const errorId = useId();
  const { error, field } = validatePosition(text);
  useEffect(() => {
    onValidityChange?.(error);
  }, [error, onValidityChange]);
  const update = (next) => {
    setText(next);
    const result = validatePosition(next);
    if (!result.error) onChange({ ...rect, ...result.rect });
  };
  return (
    <div className="studio-position-fields">
      {POSITION_FIELDS.map(([key, label, absoluteMin, max]) => {
        const min = Math.max(absoluteMin, minimum[key] ?? absoluteMin);
        return (
          <label key={key}>
            {label}
            <input
              aria-label={label}
              aria-invalid={field === key ? true : undefined}
              aria-describedby={field === key ? errorId : undefined}
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              step={1}
              value={text[key]}
              onChange={(event) =>
                update({ ...text, [key]: event.target.value })
              }
              onBlur={() => {
                const raw = String(text[key]).trim();
                if (!/^\d+$/.test(raw)) return;
                const value = String(
                  Math.max(min, Math.min(max, Number(raw))),
                );
                if (value !== raw) update({ ...text, [key]: value });
              }}
            />
          </label>
        );
      })}
      {error && (
        <p className="studio-field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function PositionEditor({ unit, onApply, onClose, blocked = false }) {
  const [rect, setRect] = useState(unit.rect);
  const [invalid, setInvalid] = useState(null);
  useEditorDraft(
    Boolean(invalid) || JSON.stringify(rect) !== JSON.stringify(unit.rect),
  );
  return (
    <>
      <div className="studio-dialog-body">
        {blocked && (
          <p className="studio-note" role="status">
            Dashboard data is updating. Your draft is still here. Keep it open,
            or close this editor to review the dashboard status.
          </p>
        )}
        <p className="studio-note">
          Adjust the shared 12-column layout. Columns and rows start at zero.
          Nearby panels move down when needed.
          {unit.minimum && (
            <>
              {" "}
              This content needs at least {unit.minimum.w} columns and{" "}
              {unit.minimum.h} rows.
            </>
          )}
        </p>
        <PositionFields
          rect={rect}
          onChange={setRect}
          onValidityChange={setInvalid}
          minimum={unit.minimum}
        />
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

export default function StackEditor({
  stack,
  board,
  onApply,
  onClose,
  onPanelEdit,
  fitting = false,
  blocked = false,
}) {
  const [draft, setDraft] = useState(() => structuredClone(stack));
  const [movedOut, setMovedOut] = useState([]);
  const [adding, setAdding] = useState(false);
  const [invalid, setInvalid] = useState(null);
  const [timingText, setTimingText] = useState(() =>
    playbackText(stack.playback),
  );
  const timingErrors = Object.fromEntries(
    PLAYBACK_FIELDS.map(({ key }) => [
      key,
      validatePlaybackField(key, timingText[key]).error,
    ]),
  );
  const timingInvalid = Object.values(timingErrors).some(Boolean);
  useEditorDraft(
    Boolean(invalid) ||
      timingInvalid ||
      JSON.stringify(draft) !== JSON.stringify(stack),
  );
  const occupied = new Set(
    board.stacks
      .filter((item) => item.id !== stack.id)
      .flatMap((item) => item.panelIds),
  );
  const candidates = board.panels.filter(
    (panel) => !draft.panelIds.includes(panel.id) && !occupied.has(panel.id),
  );
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
  const timingField = ({ key, id, label, min, max, step }) => (
    <div className="studio-field" key={key}>
      <label htmlFor={id}>{label}</label>
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
    </div>
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
    const returned = [
      ...movedOut,
      ...(draft.panelIds.length < 2 ? draft.panelIds : []),
    ];
    returned.forEach((id) => {
      const panel = next.panels.find((item) => item.id === id);
      if (panel) next = moveUnit(next, id, panel.rect);
    });
    onApply(next);
  };
  return (
    <>
      <div className="studio-dialog-body">
        {blocked && (
          <p className="studio-note" role="status">
            Dashboard data is updating. Your draft is still here. Keep it open,
            or close this editor to review the dashboard status.
          </p>
        )}
        <p className="studio-note">
          {fitting && (
            <>
              These panels have different sizes. Review their shared{" "}
              {draft.rect.w} × {draft.rect.h} size below before applying.{" "}
            </>
          )}
          Every member shares one visible size. Moving a member out keeps its
          native configuration and previous standalone dimensions.
        </p>
        <div className="studio-stack-members">
          {draft.panelIds.map((id, index) => {
            const panel = board.panels.find((item) => item.id === id);
            return (
              <div className="studio-stack-member" key={id}>
                <span className="studio-member-number">{index + 1}</span>
                <span className="studio-member-title">
                  <strong>{panel?.title}</strong>
                  <small>
                    {panel?.group}
                    {fitting && (
                      <>
                        {" "}
                        · {panel?.rect.w} × {panel?.rect.h} → {draft.rect.w} ×{" "}
                        {draft.rect.h}
                      </>
                    )}
                  </small>
                </span>
                <div className="studio-member-actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    aria-label={`Move ${panel?.title} earlier in stack`}
                    onClick={() => reorder(id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === draft.panelIds.length - 1}
                    aria-label={`Move ${panel?.title} later in stack`}
                    onClick={() => reorder(id, 1)}
                  >
                    ↓
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
                    onClick={() => {
                      setDraft({
                        ...draft,
                        panelIds: draft.panelIds.filter((item) => item !== id),
                      });
                      setMovedOut([...movedOut, id]);
                    }}
                    aria-label={`Move out ${panel?.title} from stack`}
                  >
                    Move out
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="studio-text-button"
          onClick={() => setAdding(!adding)}
        >
          <StudioIcon name="plus" size={15} />
          Add existing panel
        </button>
        {adding && (
          <div className="studio-stack-candidates">
            {candidates.map((panel) => (
              <button
                key={panel.id}
                type="button"
                onClick={() => {
                  setDraft({
                    ...draft,
                    panelIds: [...draft.panelIds, panel.id],
                  });
                  setMovedOut(movedOut.filter((id) => id !== panel.id));
                  setAdding(false);
                }}
              >
                <strong>{panel.title}</strong>
                <small>
                  {panel.rect.w} × {panel.rect.h} → shared {draft.rect.w} ×{" "}
                  {draft.rect.h}
                </small>
              </button>
            ))}
            {!candidates.length && (
              <p className="studio-muted">
                Add a widget to the board first, then include it here.
              </p>
            )}
          </div>
        )}
        <h3>Size & position</h3>
        <PositionFields
          rect={draft.rect}
          minimum={unitMinimum(
            {
              ...board,
              stacks: board.stacks.map((item) =>
                item.id === stack.id ? draft : item,
              ),
            },
            stack.id,
          )}
          onChange={(rect) => setDraft((current) => ({ ...current, rect }))}
          onValidityChange={setInvalid}
        />
        <h3>Slideshow</h3>
        <div className="studio-fields-grid">
          <div className="studio-field">
            <label htmlFor="studio-stack-mode">Start behavior</label>
            <select
              id="studio-stack-mode"
              value={draft.playback.mode}
              onChange={(event) => updatePlayback("mode", event.target.value)}
            >
              <option value="manual">Manual — use Play to start</option>
              <option value="automatic">Start automatically</option>
            </select>
          </div>
          {timingField(PLAYBACK_FIELDS[0])}
          {timingField(PLAYBACK_FIELDS[1])}
          <div className="studio-field">
            <label htmlFor="studio-stack-transition">Transition</label>
            <select
              id="studio-stack-transition"
              value={draft.playback.transition}
              onChange={(event) =>
                updatePlayback("transition", event.target.value)
              }
            >
              {[
                ["horizontal", "Horizontal slide"],
                ["vertical", "Vertical slide"],
                ["fade", "Fade"],
                ["none", "No animation"],
              ].map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {timingField(PLAYBACK_FIELDS[2])}
          <label className="studio-checkbox-field">
            <input
              type="checkbox"
              checked={draft.playback.loop}
              onChange={(event) => updatePlayback("loop", event.target.checked)}
            />
            Loop after the last widget
          </label>
        </div>
        <p className="studio-note">
          Manual switching while playing waits{" "}
          {Math.max(draft.playback.intervalMs, draft.playback.manualHoldMs) /
            1000}{" "}
          seconds, then resumes the normal timing. Paused stays paused. Hidden
          tabs, off-screen stacks, editing and focus inside native content
          temporarily stop the timer. Reduced motion suppresses automatic start
          and animation; explicit Play is available.
        </p>
      </div>
      <footer className="studio-dialog-footer">
        <button
          className="studio-text-button"
          onClick={() => onApply(unstackBoard(board, stack.id))}
          disabled={blocked}
        >
          Unstack all
        </button>
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
