import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

import { CardChart, Trend } from "./card-chart";
import { ValueSlotContext } from "./card-look";
import { CHART_SHOWS, COLLECTED_SHOWS, ruleLevel } from "./look.mjs";

import Block from "components/services/widget/block";

const keyOf = (child, index) => {
  const props = child?.props || {};
  const label = Array.isArray(props.label) ? props.label[0] : props.label;
  return typeof props.field === "string" ? props.field : typeof label === "string" ? label : `#${index}`;
};

// Values fold rather than scroll (board 28, owner note D1): when a card is
// too small for all of them, the ones that fit stay, in order, and "+N more"
// says how many are left. Measured against the card's content box, again
// whenever it changes size.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
// `least`: how many values always stay (none under a hero, which stays).
// `content`: what the card shows; new numbers (the first answer after the
// placeholders, a longer value) measure again from all shown.
function useFold(count, least = 1, content = "") {
  const ref = useRef(null);
  const [shown, setShown] = useState(count);
  const [epoch, setEpoch] = useState(0);
  // Set while a fresh measure waits for every value to show again, so the
  // fold below doesn't act on the old count in the same pass (a size or
  // font change would otherwise fold everything: review M7).
  const remeasure = useRef(false);
  useIsoLayoutEffect(() => {
    remeasure.current = true;
    // Measure afresh at the card's usual spacing.
    ref.current?.closest(".studio-native-content")?.removeAttribute("data-tight");
    ref.current?.removeAttribute("data-bare");
    setShown(count);
  }, [count, epoch, content]);
  useIsoLayoutEffect(() => {
    if (remeasure.current) {
      if (shown !== count) return;
      remeasure.current = false;
    }
    const list = ref.current;
    const clip = list?.closest(".studio-native-content");
    if (!list || !clip) return;
    const limit = clip.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(clip).paddingBottom) || 0);
    const fits = (element) => !element || element.getBoundingClientRect().bottom <= limit + 0.5;
    const items = [...list.children].filter((item) => item.classList.contains("studio-fold-item"));
    if (shown === count) {
      const measure = () => items.map((item) => (item.firstElementChild || item).getBoundingClientRect().bottom);
      let bottoms = measure();
      const all = () => !bottoms.length || bottoms.every((bottom) => bottom <= limit + 0.5);
      if (all()) return;
      // Before anything folds, the card draws a little tighter (smaller hero,
      // less space between): often that is enough for every value (board 27).
      clip.setAttribute("data-tight", "");
      bottoms = measure();
      if (all()) return;
      let fitting = bottoms.filter((bottom) => bottom <= limit + 0.5).length;
      // Under a hero, when not even one row fits below its rule, the row
      // goes without the rule (as "+N more" alone would) and often fits:
      // the band shows values rather than only the hint (review M7).
      if (!fitting && least === 0) {
        list.setAttribute("data-bare", "");
        bottoms = measure();
        if (all()) return;
        fitting = bottoms.filter((bottom) => bottom <= limit + 0.5).length;
        if (!fitting) list.removeAttribute("data-bare");
      }
      // Keep every value that fits; the check below folds one more while the
      // "+N more" hint (in the last free column of a row) doesn't fit too.
      setShown(Math.max(least, fitting));
      return;
    }
    // Folded: the values left can reflow (a narrower row, a wrapped line), so
    // check the last one and the "+N more" line really fit; else fold one more.
    const last = items[shown - 1];
    if (shown > least && (!fits(last?.firstElementChild || last) || !fits(list.querySelector(".studio-values-more"))))
      setShown(shown - 1);
  }, [shown, count, epoch, least, content]);
  useEffect(() => {
    const clip = ref.current?.closest(".studio-native-content");
    if (!clip || typeof ResizeObserver === "undefined") return undefined;
    let width = clip.clientWidth;
    let height = clip.clientHeight;
    const observer = new ResizeObserver(() => {
      if (clip.clientWidth === width && clip.clientHeight === height) return;
      width = clip.clientWidth;
      height = clip.clientHeight;
      setEpoch((value) => value + 1);
    });
    observer.observe(clip);
    // Text measures differently once the web font has loaded.
    let live = true;
    document.fonts?.ready?.then(() => live && setEpoch((value) => value + 1));
    return () => {
      live = false;
      observer.disconnect();
    };
  }, []);
  return { ref, shown, epoch };
}

// Columns for n boxes (U7): Auto uses as few rows as fit, then spreads the
// boxes evenly over them (6 boxes, room for 4: 3 by 2). A chosen number is
// kept while each box still fits; past that the boxes balance as for Auto.
export function balancedColumns(n, room, chosen = "auto") {
  if (n <= 0 || room <= 0) return 1;
  const fit = Math.max(1, room);
  const wanted = Number(chosen);
  if (Number.isInteger(wanted) && wanted > 0 && wanted <= fit) return Math.min(wanted, n) || 1;
  const rows = Math.ceil(n / fit);
  return Math.ceil(n / rows);
}

// How many boxes of the slot's smallest width fit across the list.
const BOX = { quiet: [72, 8], below: [76, 18] };
function useRoom(ref, slot, epoch) {
  const [room, setRoom] = useState(0);
  useIsoLayoutEffect(() => {
    const box = BOX[slot];
    const width = ref.current?.clientWidth || 0;
    if (!box || !width) return;
    setRoom(Math.max(1, Math.floor((width + box[1]) / (box[0] + box[1]))));
  }, [slot, epoch]);
  return room;
}

function Folded({ className, items, slot, arranged, content, columns }) {
  // The grid is worked out for every value (not only those that fit), so
  // folding never changes it; the fold measures again when it changes.
  const [grid, setGrid] = useState(0);
  const { ref, shown, epoch } = useFold(items.length, slot === "below" ? 0 : 1, `${content}#${grid}`);
  const hidden = items.length - shown;
  // A table keeps its own rows (columns null).
  const room = useRoom(ref, columns === null ? null : slot, epoch);
  const wanted = room && columns !== null ? balancedColumns(items.length, room, columns || "auto") : 0;
  useIsoLayoutEffect(() => {
    if (wanted !== grid) setGrid(wanted);
  }, [wanted, grid]);
  const style = grid ? { gridTemplateColumns: `repeat(${grid}, minmax(0, 1fr))` } : undefined;
  return (
    // Nothing left below the hero: the hint alone, without the rule.
    <div ref={ref} className={className} style={style} data-empty={items.length > 0 && shown === 0 ? "" : undefined}>
      {items.map((item, index) => (
        <div key={item.key} className="studio-fold-item" hidden={index >= shown}>
          <ValueSlotContext.Provider
            value={slot === "quiet" ? { slot, ...arranged.get(item.key) } : { ...arranged.get(item.key), slot }}
          >
            {item.child}
          </ValueSlotContext.Provider>
        </div>
      ))}
      {hidden > 0 && (
        <span
          className="studio-values-more"
          title={`${hidden} more ${hidden === 1 ? "value" : "values"}: make the widget bigger to see ${hidden === 1 ? "it" : "them"}`}
        >
          +{hidden} more
        </span>
      )}
    </div>
  );
}

// What a widget shows inside a Studio card. Hero: one value large and the rest
// below it; Quiet: Homepage's equal boxes. The widget's own arrangement
// (look.values) picks the hero, order, labels and number style; anything it
// doesn't mention keeps the widget's order, the first value as hero.
// The last values each card showed, so a card with errors hidden can keep
// them, greyed, instead of going blank.
export const lastValues = new Map();

export default function CardValues({ card, items: children }) {
  const items = children
    .filter((child) => child !== null && child !== undefined && child !== false)
    .map((child, index) => ({ child, key: keyOf(child, index), block: child?.type === Block }));
  const fieldsKey = JSON.stringify(
    items.filter((item) => item.block).map((item) => [item.key, item.child.props.label]),
  );
  // A widget that draws its own content (an embedded page, a calendar, a
  // list) has no values to arrange or fold: it shows as it is and scrolls.
  const ownContent = !items.some((item) => item.block);
  const report = card.reportFields;
  useEffect(() => {
    if (report) report(JSON.parse(fieldsKey).map(([field, label]) => ({ field, label })));
  }, [report, fieldsKey]);
  useEffect(() => {
    if (card.id && !card.stale) lastValues.set(card.id, { items: children, at: Date.now() });
  });
  // Colour rules read the latest collected number of each value.
  const latest = card.history?.latest?.values;
  const arranged = new Map(
    (card.values || []).map((value, index) => [
      value.field,
      { ...value, order: index, ...(value.rules ? { level: ruleLevel(value.rules, latest?.[value.field]) } : {}) },
    ]),
  );
  const ordered = [...items].sort((a, b) => {
    const left = arranged.get(a.key)?.order ?? Infinity;
    const right = arranged.get(b.key)?.order ?? Infinity;
    return left === right ? 0 : left - right;
  });
  const visible = ordered.filter((item) => arranged.get(item.key)?.slot !== "hidden");
  // What the values say now, so the fold measures again when they change.
  const content = visible
    .map((item) => {
      const value = item.child?.props?.value;
      return `${item.key}=${typeof value === "string" || typeof value === "number" ? value : value == null ? "" : "*"}`;
    })
    .join("|");
  if (ownContent)
    return (
      <div className="studio-card-content">
        {items.map((item, index) => (
          <Fragment key={index}>{item.child}</Fragment>
        ))}
      </div>
    );
  const show = card.show || "numbers";
  if (show === "table" || (show === "numbers" && card.layout === "quiet")) {
    return (
      <Folded
        className={`studio-values ${show === "table" ? "studio-values-table" : "studio-values-quiet"}`}
        items={visible}
        slot="quiet"
        columns={show === "table" ? null : card.columns}
        arranged={arranged}
        content={content}
      />
    );
  }
  const chosen = visible.find((item) => item.block && arranged.get(item.key)?.slot === "hero");
  const hero = chosen || visible.find((item) => item.block);
  const rest = visible.filter((item) => item !== hero);
  // A chart shows the hero value above it; its legend names the others.
  const charted = COLLECTED_SHOWS.includes(show);
  const trend = show === "numbers" && card.trend && card.trend !== "off" && hero;
  return (
    <div className={`studio-values studio-values-hero${charted ? " studio-values-charted" : ""}`}>
      {/* Gauge, donut and pie write their hero inside the chart (board 10). */}
      {hero && !["gauge", "donut", "pie"].includes(show) && (
        <ValueSlotContext.Provider value={{ ...arranged.get(hero.key), slot: "hero" }}>
          {hero.child}
        </ValueSlotContext.Provider>
      )}
      {trend && <Trend history={card.history} field={hero.key} trend={card.trend} />}
      {charted && <CardChart card={card} onOpen={CHART_SHOWS.includes(show) ? card.onFullView : undefined} />}
      {!charted && rest.length > 0 && (
        <Folded
          className="studio-values-below"
          items={rest}
          slot="below"
          columns={card.columns}
          arranged={arranged}
          content={content}
        />
      )}
    </div>
  );
}
