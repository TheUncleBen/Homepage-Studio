import { useId, useState } from "react";

import { parseColour } from "./appearance.mjs";

// A colour: pick it, or type or paste it as hex or rgb. The picked or typed
// colour is sent as hex once it is valid.
export default function ColourField({ label, value, onChange }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  const errorId = useId();
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  const valid = Boolean(parseColour(text));
  return (
    <span className="studio-colour-field">
      <input
        type="color"
        aria-label={`Pick ${label}`}
        className="studio-colour-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <input
        className="studio-colour-text"
        aria-label={label}
        value={text}
        maxLength={24}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={!valid}
        aria-describedby={valid ? undefined : errorId}
        onChange={(event) => {
          setText(event.target.value);
          const colour = parseColour(event.target.value);
          if (colour && colour !== value) {
            setShown(colour);
            onChange(colour);
          }
        }}
        onBlur={() => valid && setText(value)}
      />
      {!valid && (
        <span id={errorId} className="studio-field-error">
          Use hex, such as #b299be, or rgb, such as rgb(178, 153, 190).
        </span>
      )}
    </span>
  );
}
