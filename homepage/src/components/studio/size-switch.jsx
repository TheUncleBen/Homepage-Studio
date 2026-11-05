import { SIZE_LABEL, sizeProjection, SIZES } from "./layouts.mjs";

// The editor's size switch (owner-approved board 22): Desktop, Tablet and
// Phone, each shown at its real width.
export function SizeSwitch({ size, onChange, disabled }) {
  return (
    <div className="studio-segmented studio-size-switch" role="group" aria-label="Layout size">
      {SIZES.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={size === item}
          disabled={disabled}
          onClick={() => onChange(item)}
        >
          {SIZE_LABEL[item]}
        </button>
      ))}
    </div>
  );
}

// Under the bar on tablet or phone: whether the size follows desktop, and
// the one way back to it (board 22: Undo brings the arrangement back).
export function SizeStatus({ size, follows, onFollow, disabled }) {
  if (size === "desktop") return null;
  return (
    <p className="studio-size-status">
      <strong>{SIZE_LABEL[size]} layout:</strong>{" "}
      {follows ? (
        <>Follows desktop until you move or resize a widget here.</>
      ) : (
        <>
          your arrangement.{" "}
          <button type="button" className="studio-text-button" disabled={disabled} onClick={onFollow}>
            Follow desktop again
          </button>
        </>
      )}
    </p>
  );
}

// A small picture of one size's layout of the page, beside the one being
// edited, so the other sizes stay in view. Choosing it switches to it.
export function SizePreview({ view, size, titles, onChoose, width = 180 }) {
  const projection = sizeProjection(view, size);
  const column = width / projection.columns;
  const row = column * 0.9;
  const height = Math.max(60, Math.min(420, projection.rows * row));
  return (
    <button
      type="button"
      className="studio-size-preview"
      aria-label={`Show the ${SIZE_LABEL[size].toLowerCase()} layout`}
      onClick={onChoose}
    >
      <span className="studio-size-preview-label">{SIZE_LABEL[size]}</span>
      <span className="studio-size-preview-canvas" style={{ width, height }} aria-hidden="true">
        {projection.units.map((unit) => (
          <span
            key={unit.id}
            className="studio-size-preview-unit"
            style={{
              left: unit.rect.x * column,
              top: unit.rect.y * row,
              width: Math.max(2, unit.rect.w * column - 2),
              height: Math.max(2, unit.rect.h * row - 2),
            }}
          >
            {unit.rect.w * column > 40 && titles.get(unit.id)}
          </span>
        ))}
      </span>
    </button>
  );
}
