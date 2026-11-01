import { useEffect, useId, useMemo, useState } from "react";

import { useCardTheme } from "./card-look";
import { dashboardPath } from "./dashboard-path.mjs";
import { builtInIcon, builtInIconUrl, builtInIconValue } from "./icon-source.mjs";
import StudioIcon from "./icons";
import { Segmented } from "./ui";
import { IMAGE_REFERENCE, imageReference, UploadedImages } from "./uploaded-images";

import ResolvedIcon from "components/resolvedicon";

const SHOWN = 120;
let indexPromise = null;

// The built-in logo index is fetched once, the first time a chooser opens.
function loadIndex() {
  if (!indexPromise)
    indexPromise = fetch(dashboardPath("/studio-icons/index.json"), { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error("The built-in logos could not be loaded.");
        return response.json();
      })
      .then((data) => (Array.isArray(data?.icons) ? data.icons : []))
      .catch((error) => {
        indexPromise = null;
        throw error;
      });
  return indexPromise;
}

// Best matches first: the name itself, then names that start with the
// search, then any other match in the name, aliases or categories.
export function searchIcons(icons, query) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return icons;
  const joined = words.join("-");
  const scored = [];
  for (const [name, text] of icons) {
    const haystack = `${name} ${text}`;
    if (!words.every((word) => haystack.includes(word))) continue;
    const score = name === joined ? 0 : name.startsWith(joined) ? 1 : name.includes(joined) ? 2 : 3;
    scored.push([score, name, text]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).map(([, name, text]) => [name, text]);
}

const tabOf = (value) => {
  if (!value) return "builtin";
  if (IMAGE_REFERENCE.test(value)) return "upload";
  return builtInIcon(value) ? "builtin" : "other";
};

function BuiltInIcons({ value, onPick }) {
  const [icons, setIcons] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const { mode } = useCardTheme();
  const searchId = useId();
  useEffect(() => {
    let live = true;
    loadIndex()
      .then((list) => live && setIcons(list))
      .catch((failure) => live && setError(failure.message));
    return () => {
      live = false;
    };
  }, []);
  const results = useMemo(() => (icons ? searchIcons(icons, query) : []), [icons, query]);
  const current = builtInIcon(value)?.name;
  if (error)
    return (
      <p className="studio-field-error" role="alert">
        {error}
      </p>
    );
  return (
    <div className="studio-icon-builtin">
      <label className="studio-search-field" htmlFor={searchId}>
        <StudioIcon name="search" size={15} />
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder={icons ? `Search ${icons.length.toLocaleString()} logos` : "Loading logos…"}
          aria-label="Search logos"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {icons && !results.length && <p className="studio-muted">No logo matches “{query.trim()}”.</p>}
      {results.length > 0 && (
        <div className="studio-icon-grid" role="radiogroup" aria-label="Built-in logos">
          {results.slice(0, SHOWN).map(([name]) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={current === name}
              className="studio-icon-option"
              title={name}
              onClick={() => onPick(builtInIconValue(name))}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={builtInIconUrl(name, { dark: mode === "dark" })} alt="" loading="lazy" width={32} height={32} />
              <span>{name.replace(/-/g, " ")}</span>
            </button>
          ))}
        </div>
      )}
      {results.length > SHOWN && (
        <p className="studio-muted">
          Showing {SHOWN} of {results.length.toLocaleString()}. Type more of the name to narrow it down.
        </p>
      )}
      <p className="studio-note">Logos from the Dashboard Icons project.</p>
    </div>
  );
}

// Anything else an icon can be: another icon set or an address.
function OtherIcon({ value, onPick }) {
  const [text, setText] = useState(tabOf(value) === "other" ? value : "");
  const id = useId();
  const trimmed = text.trim();
  return (
    <div className="studio-icon-other">
      <label htmlFor={id}>Icon name or address</label>
      <div className="studio-inline-field">
        <input
          id={id}
          value={text}
          placeholder="mdi-filmstrip, si-github or https://…"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && trimmed) {
              event.preventDefault();
              onPick(trimmed);
            }
          }}
        />
        <button
          type="button"
          className="studio-button"
          disabled={!trimmed || trimmed === value}
          onClick={() => onPick(trimmed)}
        >
          Use
        </button>
      </div>
      <p className="studio-note">
        Material Design icons start with mdi-, Simple Icons with si-, selfh.st icons with sh-. An address loads the
        picture from there.
      </p>
    </div>
  );
}

// Choosing an icon: a built-in logo, one uploaded to this dashboard, or a
// name or address typed in.
export function IconChooser({ value, onPick }) {
  const [tab, setTab] = useState(() => tabOf(value));
  const uploaded = IMAGE_REFERENCE.exec(value || "")?.[1] ?? null;
  return (
    <div className="studio-icon-chooser">
      <Segmented
        label="Kind of icon"
        value={tab}
        onChange={setTab}
        options={[
          ["builtin", "Built in"],
          ["upload", "Uploaded"],
          ["other", "Other"],
        ]}
      />
      {tab === "builtin" && <BuiltInIcons value={value} onPick={onPick} />}
      {tab === "upload" && <UploadedImages kind="logo" value={uploaded} onPick={(id) => onPick(imageReference(id))} />}
      {tab === "other" && <OtherIcon value={value} onPick={onPick} />}
    </div>
  );
}

// The icon setting on a widget or bookmark: what it shows now, Change, and
// Remove. The chooser opens in place.
export function IconField({ id, label, value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="studio-icon-field">
      <div className="studio-icon-current">
        <span className="studio-icon-preview" aria-hidden="true">
          {value ? <ResolvedIcon icon={value} width={28} height={28} alt="" /> : <StudioIcon name="image" size={18} />}
        </span>
        <span className="studio-icon-value" id={id}>
          {value ? describeIcon(value) : "No icon"}
        </span>
        <button
          type="button"
          className="studio-button studio-quiet"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Done" : value ? "Change" : "Choose"}
        </button>
        {value && (
          <button
            type="button"
            className="studio-icon-button"
            aria-label={`Remove ${label}`}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            <StudioIcon name="close" size={14} />
          </button>
        )}
      </div>
      {open && (
        <IconChooser
          value={value}
          onPick={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

export function describeIcon(value) {
  if (IMAGE_REFERENCE.test(value)) return "Uploaded logo";
  const builtIn = builtInIcon(value);
  return builtIn ? builtIn.name.replace(/-/g, " ") : value;
}
