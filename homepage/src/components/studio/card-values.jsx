import { useTranslation } from "next-i18next/pages";
import { Fragment, useContext, useEffect, useLayoutEffect } from "react";

import { CardChart, PALETTE, StatusHistory, Trend, chartSeries, useFormatValue } from "./card-chart";
import CardLogs, { useLogsAllowed } from "./card-logs";
import { CardFitContext, ValueSlotContext } from "./card-look";
import { COLLECTED_BLOCKS, REST_BLOCKS, VALUE_BLOCKS, blocksOf, ruleLevel } from "./look.mjs";

import Block from "components/services/widget/block";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const keyOf = (child, index) => {
  const props = child?.props || {};
  const label = Array.isArray(props.label) ? props.label[0] : props.label;
  return typeof props.field === "string" ? props.field : typeof label === "string" ? label : `#${index}`;
};

// Which values each block shows (mock-ups v4). A block's own list wins, in its
// order; the default Big number shows the widget's first value; a Numbers or
// Quiet block with none picked shows the values no other block shows, so a
// widget whose fields change keeps showing them all. A chart with none picked
// draws every number Studio collects.
export function blockFields(blocks, keys, collected = []) {
  const taken = new Set();
  for (const block of blocks) {
    if (!VALUE_BLOCKS.includes(block.type) || COLLECTED_BLOCKS.includes(block.type)) continue;
    if (Array.isArray(block.values)) block.values.forEach((key) => taken.add(key));
    else if (block.first && keys.length) taken.add(keys[0]);
  }
  const present = new Set(keys);
  const out = {};
  for (const block of blocks) {
    if (!VALUE_BLOCKS.includes(block.type)) out[block.id] = [];
    else if (COLLECTED_BLOCKS.includes(block.type))
      out[block.id] = Array.isArray(block.values)
        ? block.values
        : block.type === "gauge"
          ? collected.slice(0, 1)
          : collected;
    else if (Array.isArray(block.values)) out[block.id] = block.values.filter((key) => present.has(key));
    else if (block.first) out[block.id] = keys.slice(0, 1);
    else if (REST_BLOCKS.includes(block.type)) out[block.id] = keys.filter((key) => !taken.has(key));
    else out[block.id] = [];
  }
  return out;
}

// Bars: each value's latest number as a bar against the largest.
function NowBars({ card, fields, labels }) {
  const { t } = useTranslation();
  const format = useFormatValue();
  const history = card.history;
  const series = chartSeries(history, { ...card, fields }, (label) => t(label));
  const latest = history?.latest?.values || {};
  const shown = series.filter((entry) => Number.isFinite(latest[entry.field.field]));
  if (!history) return <p className="studio-chart-note">Loading…</p>;
  if (!shown.length) return <p className="studio-chart-note">Collecting numbers. Bars show within a minute.</p>;
  const top = Math.max(...shown.map((entry) => Math.abs(latest[entry.field.field])), 0) || 1;
  return (
    <div
      className="studio-bars-now"
      data-labels={labels ? undefined : "off"}
      role="img"
      aria-label={shown.map((entry) => `${entry.name}: ${format(entry.field, latest[entry.field.field])}`).join(", ")}
    >
      {shown.map((entry, index) => {
        const value = latest[entry.field.field];
        return (
          <Fragment key={entry.field.field}>
            {labels && <span className="studio-bar-label">{entry.name}</span>}
            <span className="studio-bar-track" aria-hidden="true">
              <i
                style={{
                  width: `${Math.max(2, (Math.abs(value) / top) * 100)}%`,
                  background: entry.colour || PALETTE[index % PALETTE.length],
                }}
              />
            </span>
            <strong className="studio-bar-value">{format(entry.field, value)}</strong>
          </Fragment>
        );
      })}
    </div>
  );
}

function ValueBlock({ block, items, arranged, slot }) {
  const labels = block.labels !== false;
  return (
    <div className="studio-block-values">
      {items.map((item) => (
        <ValueSlotContext.Provider key={item.key} value={{ ...arranged.get(item.key), slot, noLabel: !labels }}>
          {item.child}
        </ValueSlotContext.Provider>
      ))}
    </div>
  );
}

// One block, drawn with every value it shows (nothing folds).
function BlockBody({ block, card, fields, byKey, arranged }) {
  const items = fields.map((key) => byKey.get(key)).filter(Boolean);
  const pseudo = (show, extra = {}) => ({ ...card, show, fields, ...extra });
  switch (block.type) {
    case "big":
      return (
        <>
          <ValueBlock block={block} items={items} arranged={arranged} slot="big" />
          {block.trend && block.trend !== "off" && items[0] && (
            <Trend history={card.history} field={items[0].key} trend={block.trend} />
          )}
        </>
      );
    case "numbers":
      return <ValueBlock block={block} items={items} arranged={arranged} slot="number" />;
    case "quiet":
      return <ValueBlock block={block} items={items} arranged={arranged} slot="quiet" />;
    case "pie":
      return <CardChart card={pseudo(block.style || "donut")} />;
    case "gauge":
      return <CardChart card={pseudo("gauge")} />;
    case "chart":
      return (
        <CardChart
          card={pseudo(block.style || "line", { chartRange: block.range || "24h" })}
          onOpen={
            card.onFullView
              ? () => card.onFullView({ fields, show: block.style || "line", range: block.range })
              : undefined
          }
        />
      );
    case "bars":
      return <NowBars card={card} fields={fields} labels={block.labels !== false} />;
    case "response":
      return (
        <CardChart card={{ ...card, show: "line", fields: ["ms"], check: true, chartRange: block.range || "1h" }} />
      );
    case "status":
      return <StatusHistory card={{ ...card, chartRange: block.range || "24h" }} />;
    case "logs":
      return <CardLogs card={card} />;
    default:
      return null;
  }
}

const EMPTY_NOTES = {
  big: "Pick a value for this Big number",
  numbers: "Pick values for these numbers",
  quiet: "Pick values for these numbers",
  pie: "Pick numbers for this pie",
  bars: "Pick numbers for these bars",
  chart: "Pick numbers for this chart",
  gauge: "Pick a number for this gauge",
};

// The blocks of a card at its size. Shared by integration widgets (with
// their values) and service cards (status, response time and logs only).
export function CardBlocks({ card, items = [] }) {
  const fit = useContext(CardFitContext);
  const logsAllowed = useLogsAllowed();
  // A service card has no values, so only its status, response time and logs
  // blocks draw; logs only for people who can read this dashboard's logs.
  const listed = (fit?.blocks || blocksOf(card)).filter(
    (block) => (items.length || !VALUE_BLOCKS.includes(block.type)) && (block.type !== "logs" || logsAllowed),
  );
  const byKey = new Map(items.map((item) => [item.key, item]));
  const latest = card.history?.latest?.values;
  const arranged = new Map(
    (card.values || []).map((value) => [
      value.field,
      { ...value, ...(value.rules ? { level: ruleLevel(value.rules, latest?.[value.field]) } : {}) },
    ]),
  );
  const collected = (card.history?.fields || [])
    .map((field) => field.field)
    .filter((key) => !["up", "ms"].includes(key));
  const listedFields = blockFields(
    listed,
    items.map((item) => item.key),
    collected,
  );
  // A value block left with no values (a one-value widget's default Numbers,
  // say) is drawn only while editing, where it says what to pick; on the live
  // dashboard it is left out rather than showing that note to every viewer.
  // Blocks someone chose (not the default Big number and Numbers).
  const chosen =
    Array.isArray(card.look?.blocks) ||
    Object.values(card.look?.sizes || {}).some((size) => Array.isArray(size?.blocks));
  const blocks =
    card.editing && chosen
      ? listed
      : listed.filter((block) => !VALUE_BLOCKS.includes(block.type) || listedFields[block.id].length);
  const fields = listedFields;
  // The card fits the blocks it really drew, with how many values each has.
  const drawn = JSON.stringify(blocks.map((block) => [block.id, fields[block.id].length]));
  const report = fit?.report;
  // Before paint, so the card never shows a frame drawn without its fit.
  useIsoLayoutEffect(() => {
    report?.(JSON.parse(drawn));
  }, [report, drawn]);
  if (!blocks.length) return null;
  return (
    <div className="studio-blocks" data-dir="col">
      {blocks.map((block) => {
        const shown = fields[block.id];
        const empty = VALUE_BLOCKS.includes(block.type) && !shown.length;
        return (
          <div
            key={block.id}
            className="studio-block"
            data-block={block.id}
            data-type={block.type}
            data-size={block.type === "big" ? block.size || "m" : undefined}
            data-clip={block.type === "logs" ? "" : undefined}
            data-pick={`block-${block.id}`}
          >
            {empty ? (
              <p className="studio-chart-note">{EMPTY_NOTES[block.type]}</p>
            ) : (
              <BlockBody block={block} card={card} fields={shown} byKey={byKey} arranged={arranged} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// The last values each card showed, so a card with errors hidden can keep
// them, greyed, instead of going blank.
export const lastValues = new Map();

// What an integration widget shows inside a Studio card: its blocks.
export default function CardValues({ card, items: children }) {
  const items = children
    .filter((child) => child !== null && child !== undefined && child !== false)
    .map((child, index) => ({ child, key: keyOf(child, index), block: child?.type === Block }));
  const fieldsKey = JSON.stringify(
    items.filter((item) => item.block).map((item) => [item.key, item.child.props.label]),
  );
  // A widget that draws its own content (an embedded page, a calendar, a
  // list) has no values to arrange: it shows as it is and scrolls.
  const ownContent = !items.some((item) => item.block);
  const report = card.reportFields;
  useEffect(() => {
    if (report) report(JSON.parse(fieldsKey).map(([field, label]) => ({ field, label })));
  }, [report, fieldsKey]);
  useEffect(() => {
    if (card.id && !card.stale) lastValues.set(card.id, { items: children, at: Date.now() });
  });
  if (ownContent)
    return (
      <div className="studio-card-content">
        {items.map((item, index) => (
          <Fragment key={index}>{item.child}</Fragment>
        ))}
      </div>
    );
  return <CardBlocks card={card} items={items.filter((item) => item.block)} />;
}
