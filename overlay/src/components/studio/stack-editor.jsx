import { useState } from "react";

import { clampRect, moveUnit, unstackBoard, unitMinimum } from "./geometry.mjs";
import StudioIcon from "./icons";

export function PositionFields({ rect, onChange, minimum = { w: 1, h: 1 } }) {
  return (
    <div className="studio-position-fields">
      {[
        ["x", "Column", 0, 11],
        ["y", "Row", 0, 100000],
        ["w", "Width", minimum.w, 12],
        ["h", "Height", minimum.h, 1000],
      ].map(([key, label, min, max]) => (
        <label key={key}>
          {label}
          <input
            aria-label={label}
            type="number"
            min={min}
            max={max}
            step={1}
            value={rect[key]}
            onChange={(event) =>
              onChange(
                clampRect({
                  ...rect,
                  [key]: Math.max(min, Number(event.target.value)),
                }),
              )
            }
          />
        </label>
      ))}
    </div>
  );
}

export function PositionEditor({ unit, onApply, onClose }) {
  const [rect, setRect] = useState(unit.rect);
  return (
    <>
      <div className="studio-dialog-body">
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
        <PositionFields rect={rect} onChange={setRect} minimum={unit.minimum} />
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button className="studio-button studio-quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          className="studio-button studio-primary"
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
}) {
  const [draft, setDraft] = useState(() => structuredClone(stack));
  const [movedOut, setMovedOut] = useState([]);
  const [adding, setAdding] = useState(false);
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
                    disabled={fitting}
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
          onChange={(rect) => setDraft({ ...draft, rect })}
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
          <div className="studio-field">
            <label htmlFor="studio-stack-interval">Seconds per widget</label>
            <input
              id="studio-stack-interval"
              type="number"
              min={1}
              max={3600}
              value={draft.playback.intervalMs / 1000}
              onChange={(event) =>
                updatePlayback(
                  "intervalMs",
                  Math.max(
                    1000,
                    Math.min(
                      3600000,
                      Math.round(Number(event.target.value) * 1000),
                    ),
                  ),
                )
              }
            />
          </div>
          <div className="studio-field">
            <label htmlFor="studio-stack-manual-delay">
              Manual navigation delay (seconds)
            </label>
            <input
              id="studio-stack-manual-delay"
              type="number"
              min={1}
              max={3600}
              value={draft.playback.manualHoldMs / 1000}
              onChange={(event) =>
                updatePlayback(
                  "manualHoldMs",
                  Math.max(
                    1000,
                    Math.min(
                      3600000,
                      Math.round(Number(event.target.value) * 1000),
                    ),
                  ),
                )
              }
            />
          </div>
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
          <div className="studio-field">
            <label htmlFor="studio-stack-duration">
              Animation duration (ms)
            </label>
            <input
              id="studio-stack-duration"
              type="number"
              min={0}
              max={2000}
              step={10}
              value={draft.playback.transitionDurationMs}
              onChange={(event) =>
                updatePlayback(
                  "transitionDurationMs",
                  Math.max(
                    0,
                    Math.min(2000, Math.round(Number(event.target.value))),
                  ),
                )
              }
            />
          </div>
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
        >
          Unstack all
        </button>
        <span className="studio-footer-spacer" />
        <button className="studio-button studio-quiet" onClick={onClose}>
          Cancel
        </button>
        <button className="studio-button studio-primary" onClick={apply}>
          Apply to arrangement
        </button>
      </footer>
    </>
  );
}
