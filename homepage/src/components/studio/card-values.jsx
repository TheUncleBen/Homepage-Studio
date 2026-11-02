import { useEffect } from "react";

import { CardChart, Trend } from "./card-chart";
import { ValueSlotContext } from "./card-look";
import { CHART_SHOWS, COLLECTED_SHOWS, ruleLevel } from "./look.mjs";

import Block from "components/services/widget/block";

const keyOf = (child, index) => {
  const props = child?.props || {};
  const label = Array.isArray(props.label) ? props.label[0] : props.label;
  return typeof props.field === "string" ? props.field : typeof label === "string" ? label : `#${index}`;
};

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
      <div className={`studio-values ${show === "table" ? "studio-values-table" : "studio-values-quiet"}`}>
        {visible.map((item) => (
          <ValueSlotContext.Provider key={item.key} value={{ slot: "quiet", ...arranged.get(item.key) }}>
            {item.child}
          </ValueSlotContext.Provider>
        ))}
      </div>
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
        <div className="studio-values-below">
          {rest.map((item) => (
            <ValueSlotContext.Provider key={item.key} value={{ ...arranged.get(item.key), slot: "below" }}>
              {item.child}
            </ValueSlotContext.Provider>
          ))}
        </div>
      )}
    </div>
  );
}
