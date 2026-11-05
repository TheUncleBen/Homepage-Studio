import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
function useFold(count) {
  const ref = useRef(null);
  const [shown, setShown] = useState(count);
  const [epoch, setEpoch] = useState(0);
  useIsoLayoutEffect(() => setShown(count), [count, epoch]);
  useIsoLayoutEffect(() => {
    if (shown !== count) return;
    const list = ref.current;
    const clip = list?.closest(".studio-native-content");
    if (!list || !clip) return;
    const limit = clip.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(clip).paddingBottom) || 0);
    const bottoms = [...list.children]
      .filter((item) => item.classList.contains("studio-fold-item"))
      .map((item) => (item.firstElementChild || item).getBoundingClientRect().bottom);
    if (!bottoms.length || bottoms.every((bottom) => bottom <= limit + 0.5)) return;
    // Room for the "+N more" line under the values that stay.
    const room = limit - 20;
    setShown(Math.max(1, bottoms.filter((bottom) => bottom <= room + 0.5).length));
  }, [shown, count, epoch]);
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
    return () => observer.disconnect();
  }, []);
  return { ref, shown };
}

function Folded({ className, items, slot, arranged }) {
  const { ref, shown } = useFold(items.length);
  const hidden = items.length - shown;
  return (
    <div ref={ref} className={className}>
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
  const show = card.show || "numbers";
  if (show === "table" || (show === "numbers" && card.layout === "quiet")) {
    return (
      <Folded
        className={`studio-values ${show === "table" ? "studio-values-table" : "studio-values-quiet"}`}
        items={visible}
        slot="quiet"
        arranged={arranged}
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
        <Folded className="studio-values-below" items={rest} slot="below" arranged={arranged} />
      )}
    </div>
  );
}
