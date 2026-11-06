import { useEffect, useId, useMemo, useRef, useState } from "react";

import { dashboardPath } from "./dashboard-path.mjs";
import { pageOf } from "./geometry.mjs";
import StudioIcon from "./icons";
import { resolveNativePanel } from "./native-adapter.mjs";
import { searchAddress, searchEngine, usePreferences } from "./preferences";

import ResolvedIcon from "components/resolvedicon";

const KIND_LABEL = {
  service: "Service",
  serviceWidget: "Integration widget",
  bookmark: "Bookmark",
  informationWidget: "Information widget",
};
const LIMIT = 8;
// Leaving the dashboard in this tab, kept apart so tests can watch it.
export const navigation = { assign: (href) => window.location.assign(href) };

// Everything on the dashboard that can be found: every widget, service and
// bookmark on every page, with its page.
export function searchableItems(board, data) {
  const pages = new Map((board?.pages || []).map((page) => [page.id, page.name]));
  const items = (board?.panels || []).map((panel) => {
    const resolved = resolveNativePanel(panel, data);
    const item = resolved?.service || resolved?.bookmark || null;
    return {
      id: panel.id,
      kind: panel.kind,
      name: item?.name || panel.title || "Widget",
      description: typeof item?.description === "string" ? item.description : "",
      href: typeof item?.href === "string" ? item.href : null,
      icon: typeof item?.icon === "string" ? item.icon : null,
      pageId: pageOf(board, panel),
      pageName: pages.get(pageOf(board, panel)) || "",
      service: resolved?.service ? `${resolved.groupName}\u0000${resolved.service.name}` : null,
    };
  });
  // A service and its integration widget are one result: the service tile
  // when it is on the dashboard, otherwise the widget.
  const tiles = new Set(items.filter((item) => item.kind === "service" && item.service).map((item) => item.service));
  return items
    .filter((item) => item.kind !== "serviceWidget" || !tiles.has(item.service))
    .map(({ service, ...item }) => item);
}

// Best first: names that start with the search, then names that contain
// it, then descriptions (when the person searches them).
export function matchItems(items, query, { descriptions = true } = {}) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored = [];
  for (const item of items) {
    const name = item.name.toLowerCase();
    const score = name.startsWith(needle)
      ? 0
      : name.includes(needle)
        ? 1
        : descriptions && item.description.toLowerCase().includes(needle)
          ? 2
          : -1;
    if (score >= 0) scored.push([score, item]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).map(([, item]) => item);
}

// A typed web address, such as example.org or https://example.org/path.
export function typedAddress(query) {
  const text = query.trim();
  if (!text || /\s/.test(text)) return null;
  if (/^https?:\/\//i.test(text)) return text;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(text) ? `https://${text}` : null;
}

function useSuggestions(engine, query, enabled) {
  const [answer, setAnswer] = useState({ text: "", list: [] });
  const text = query.trim();
  const wanted = Boolean(enabled && engine.suggestions && text);
  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      fetch(
        dashboardPath(
          `/api/search/searchSuggestion?query=${encodeURIComponent(text)}&providerName=${encodeURIComponent(engine.suggestions)}`,
        ),
        { credentials: "same-origin" },
      )
        .then((response) => (response.ok ? response.json() : null))
        .then((value) => {
          if (!live) return;
          const list = Array.isArray(value?.[1]) ? value[1].filter((entry) => typeof entry === "string") : [];
          setAnswer({ text, list: list.filter((entry) => entry.trim() !== text).slice(0, 4) });
        })
        .catch(() => {});
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [engine, text, wanted]);
  // Only suggestions for what is typed now.
  return wanted && answer.text === text ? answer.list : [];
}

// Search across every page, plus the web with the viewer's own engine.
// Opens with / or Ctrl K, or by typing on the dashboard.
export default function StudioSearch({ board, data, query, onQuery, onClose, onShowPanel }) {
  const preferences = usePreferences();
  const engine = searchEngine(preferences);
  const input = useRef(null);
  const dialog = useRef(null);
  const listId = useId();
  const [pointer, setPointer] = useState({ query, index: 0 });
  // A new search starts at the top.
  const active = pointer.query === query ? pointer.index : 0;
  const setActive = (index) => setPointer({ query, index });
  const items = useMemo(() => searchableItems(board, data), [board, data]);
  const found = useMemo(
    () => matchItems(items, query, { descriptions: preferences.searchDescriptions }).slice(0, LIMIT),
    [items, query, preferences.searchDescriptions],
  );
  const suggestions = useSuggestions(engine, query, preferences.searchSuggestions);
  const address = preferences.searchAddresses ? typedAddress(query) : null;
  const text = query.trim();
  const web = text
    ? [
        ...(address ? [{ type: "address", label: `Open ${address}`, href: address }] : []),
        {
          type: "web",
          label: `Search ${engine.custom ? "the web" : engine.name} for “${text}”`,
          href: searchAddress(engine, text),
        },
        ...suggestions.map((entry) => ({ type: "suggestion", label: entry, href: searchAddress(engine, entry) })),
      ]
    : [];
  const results = [...found.map((item) => ({ type: "item", item })), ...web];
  const current = Math.min(active, Math.max(0, results.length - 1));
  useEffect(() => {
    const element = dialog.current;
    if (element?.showModal && !element.open) element.showModal();
    else element?.setAttribute("open", "");
    input.current?.focus();
    const length = input.current?.value.length ?? 0;
    input.current?.setSelectionRange(length, length);
  }, []);
  const open = (href) => {
    if (preferences.searchOpens !== "new") navigation.assign(href);
    else window.open(href, "_blank", "noopener,noreferrer");
  };
  const choose = (result) => {
    if (!result) return;
    onClose();
    if (result.type !== "item") return open(result.href);
    // A link opens; anything else takes you to its page.
    if (result.item.href) return open(result.item.href);
    return onShowPanel(result.item);
  };
  const optionId = (index) => `${listId}-${index}`;
  return (
    <dialog
      ref={dialog}
      className="studio-find"
      aria-label="Search"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="studio-find-box">
        <StudioIcon name="search" size={18} />
        <input
          ref={input}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={results.length ? optionId(current) : undefined}
          aria-autocomplete="list"
          aria-label="Search this dashboard and the web"
          placeholder="Search widgets, links and the web"
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (results.length)
                setActive((current + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(results[current]);
            }
          }}
        />
        {/* A keyboard closes it with Esc; a touch screen with Cancel (review L6). */}
        <kbd className="studio-find-esc">Esc</kbd>
        <button type="button" className="studio-text-button studio-find-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
      <div id={listId} role="listbox" aria-label="Results" className="studio-find-results">
        {found.length > 0 && (
          <div role="presentation" className="studio-find-heading">
            On this dashboard · all pages
          </div>
        )}
        {results.map((result, index) => {
          const selected = index === current;
          const common = {
            id: optionId(index),
            role: "option",
            "aria-selected": selected,
            className: "studio-find-option",
            onMouseMove: () => setActive(index),
            onClick: () => choose(result),
          };
          if (result.type === "item")
            return (
              <div key={result.item.id} {...common}>
                <span className="studio-find-icon" aria-hidden="true">
                  {result.item.icon ? (
                    <ResolvedIcon icon={result.item.icon} width={22} height={22} alt="" />
                  ) : (
                    <StudioIcon name="layout" size={16} />
                  )}
                </span>
                <span className="studio-find-text">
                  <strong>{result.item.name}</strong>
                  <small>{result.item.description || KIND_LABEL[result.item.kind]}</small>
                </span>
                {result.item.pageName && <span className="studio-find-page">{result.item.pageName}</span>}
              </div>
            );
          const first = index === found.length;
          return (
            <div key={`${result.type}-${result.label}`} role="presentation">
              {first && (
                <div role="presentation" className="studio-find-heading">
                  Web · {engine.name}
                </div>
              )}
              <div {...common}>
                <span className="studio-find-icon" aria-hidden="true">
                  <StudioIcon name={result.type === "address" ? "link" : "search"} size={16} />
                </span>
                <span className="studio-find-text">
                  <strong>{result.label}</strong>
                </span>
                {selected && <kbd>Enter</kbd>}
              </div>
            </div>
          );
        })}
        {text && !results.length && <p className="studio-muted studio-find-empty">Nothing found.</p>}
      </div>
    </dialog>
  );
}
