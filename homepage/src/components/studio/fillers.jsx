import { useContext } from "react";

import { CardLookContext } from "./card-look";
import { dashboardPath } from "./dashboard-path.mjs";
import { IMAGE_REFERENCE } from "./uploaded-images";

// Studio's own information widgets (U6, owner feedback T8 on 65f724c): things
// to fill and group a dashboard with, where Homepage has nothing. They need
// no service and fetch nothing. Their settings live in widgets.yaml like any
// information widget's.
// - Heading: a title for a row of widgets.
// - Note: text you write yourself. Plain text only: line breaks are kept and
//   web addresses become links; nothing in it is read as HTML.
// - Picture: one picture from this dashboard's uploaded backgrounds.
// - Spacer: holds space in one layout. Only visible while editing.
export const FILLER_TYPES = Object.freeze(["heading", "note", "picture", "spacer"]);
export const isFiller = (type) => FILLER_TYPES.includes(type);

const SIZES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];
const size = (value, fallback) => (SIZES.includes(value) ? value : fallback);

// A web address in a note, up to the next space. Punctuation that ends a
// sentence stays out of the link.
const LINK = /\bhttps?:\/\/[^\s<>"']+/g;
export function noteParts(text) {
  const parts = [];
  let last = 0;
  for (const match of String(text ?? "").matchAll(LINK)) {
    const address = match[0].replace(/[.,;:!?)\]]+$/, "");
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ link: address });
    last = match.index + address.length;
  }
  if (last < String(text ?? "").length) parts.push({ text: String(text).slice(last) });
  return parts;
}

function Heading({ options }) {
  const text = typeof options.text === "string" ? options.text.trim() : "";
  return (
    <div className={`studio-filler studio-filler-heading studio-datetime-${size(options.text_size, "xl")}`}>
      <h2 className="studio-filler-text">{text || "Heading"}</h2>
    </div>
  );
}

function Note({ options }) {
  const card = useContext(CardLookContext);
  const text = typeof options.text === "string" ? options.text : "";
  const newTab = (card?.target ?? "new") === "new";
  return (
    <div className={`studio-filler studio-filler-note studio-filler-note-${size(options.text_size, "sm")}`}>
      <p className="studio-filler-text">
        {text.trim() ? (
          noteParts(text).map((part, index) =>
            part.link ? (
              <a
                key={index}
                href={part.link}
                {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noreferrer" })}
              >
                {part.link}
              </a>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )
        ) : (
          <span className="studio-filler-hint">Write your note in its settings.</span>
        )}
      </p>
    </div>
  );
}

function Picture({ options }) {
  const reference = typeof options.image === "string" ? options.image : "";
  if (!IMAGE_REFERENCE.test(reference))
    return (
      <div className="studio-filler studio-filler-picture studio-filler-picture-empty">
        <p className="studio-filler-hint">Choose a picture in its settings.</p>
      </div>
    );
  return (
    <div className="studio-filler studio-filler-picture">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dashboardPath(reference)}
        alt={typeof options.alt === "string" ? options.alt : ""}
        loading="lazy"
        decoding="async"
        style={{ objectFit: options.fit === "fit" ? "contain" : "cover" }}
      />
    </div>
  );
}

function Spacer() {
  return (
    <div className="studio-filler studio-filler-spacer" aria-hidden="true">
      <span>Spacer</span>
    </div>
  );
}

const COMPONENTS = { heading: Heading, note: Note, picture: Picture, spacer: Spacer };

export default function Filler({ widget }) {
  const Component = COMPONENTS[widget?.type];
  return Component ? <Component options={widget.options ?? {}} /> : null;
}
