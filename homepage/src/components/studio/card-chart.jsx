import { useTranslation } from "next-i18next/pages";
import { useId, useMemo, useState } from "react";
import useSWR from "swr";

import { studioRequest } from "./api.mjs";
import { dashboardPath } from "./dashboard-path.mjs";
import StudioDialog from "./dialog";
import { allBlocks, needsHistory, ruleLevel } from "./look.mjs";
import { Segmented } from "./ui";

// Charts (boards 6, 10, 15): drawn from the history Studio's collector keeps
// for widgets shown this way (server/history.mjs). Every number is written
// with the same formatter the widget itself uses.

export const RANGE_LABELS = {
  "1h": "Last hour",
  "6h": "Last 6 h",
  "24h": "Last 24 h",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};
export const CHART_SHOWS = Object.freeze(["line", "area", "bar"]);
const RANGE_SPAN = { "1h": 3600e3, "6h": 6 * 3600e3, "24h": 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3 };

// The ranges the dashboard keeps history for (Chart history: 7, 30 or 90
// days, 30 unless changed), plus the one a widget already uses.
export function chartRanges(settings, current) {
  const days = [7, 30, 90].includes(settings?.studioDefaults?.chartDays) ? settings.studioDefaults.chartDays : 30;
  return Object.keys(RANGE_LABELS).filter((key) => RANGE_SPAN[key] <= days * 86400e3 || key === current);
}

const TREND_SPAN = { hour: 3600e3, day: 86400e3, week: 7 * 86400e3 };
const TREND_WORDS = { hour: "vs an hour ago", day: "vs yesterday", week: "vs last week" };
// Line colours in order, for values without their own colour. Hex, so the
// widget dialog can show each line's colour as it is drawn.
export const PALETTE = ["#5aa9e6", "#e0a03b", "#b48ead", "#6cc1a5", "#e07a5f", "#c9b458"];

const historyPath = (panelId, range) =>
  dashboardPath(`/studio/api/history?${new URLSearchParams({ panel: panelId, range })}`);

// The range a card reads: the longest its blocks need, at any size (a chart's
// range, response time's, or long enough for a trend). Status history reads
// its own.
const TREND_RANGE = { hour: "6h", day: "7d", week: "30d" };
export function historyRange(look) {
  const order = Object.keys(RANGE_SPAN);
  let wanted = "1h";
  for (const block of allBlocks(look)) {
    const range =
      block.type === "chart" || block.type === "response"
        ? block.range || (block.type === "chart" ? "24h" : "1h")
        : block.type === "big" && TREND_RANGE[block.trend]
          ? TREND_RANGE[block.trend]
          : null;
    if (range && order.indexOf(range) > order.indexOf(wanted)) wanted = range;
  }
  return wanted;
}

export function useCardHistory(panel, look) {
  const wanted = ["serviceWidget", "service"].includes(panel?.kind) && Boolean(panel.id) && needsHistory(look);
  const { data } = useSWR(wanted ? historyPath(panel.id, historyRange(look)) : null, studioRequest, {
    // Until the first numbers arrive (a widget just switched to a chart),
    // look again every few seconds rather than once a minute.
    refreshInterval: (latest) => (latest?.latest ? 60000 : 5000),
  });
  return wanted ? data : undefined;
}

// One value written as the widget writes it.
export function useFormatValue() {
  const { t } = useTranslation();
  return (field, value) => {
    if (!Number.isFinite(value)) return "–";
    if (!field || field.format === "plain") return String(value);
    const { field: _f, label: _l, format, ...options } = field;
    return t(`common.${format}`, { value, ...options });
  };
}

// The number a value had about `span` ago, and the change since.
export function trendOf(history, field, span) {
  const index = history?.fields?.findIndex((entry) => entry.field === field);
  if (index === undefined || index < 0) return null;
  const latest = history.latest?.values?.[field];
  if (!Number.isFinite(latest)) return null;
  const target = history.latest.at - span;
  let best = null;
  for (const point of history.points) {
    if (!Number.isFinite(point[index + 1])) continue;
    if (!best || Math.abs(point[0] - target) < Math.abs(best[0] - target)) best = point;
  }
  // Nothing within a quarter of the span of the target: not enough history yet.
  if (!best || Math.abs(best[0] - target) > span / 4) return null;
  return { from: best[index + 1], change: latest - best[index + 1] };
}

export function Trend({ history, field, trend }) {
  const format = useFormatValue();
  const result = trendOf(history, field, TREND_SPAN[trend]);
  if (!result) return null;
  const meta = history.fields.find((entry) => entry.field === field);
  const direction = result.change > 0 ? "up" : result.change < 0 ? "down" : "same";
  return (
    <span className={`studio-trend studio-trend-${direction}`}>
      <span aria-hidden="true">{direction === "up" ? "▲" : direction === "down" ? "▼" : "•"}</span>{" "}
      {format(meta, Math.abs(result.change))} {TREND_WORDS[trend]}
    </span>
  );
}

// Which of the history's values a chart draws: the block's values (card.fields)
// in its order, or every collected number, with their own names and colours.
// The status check's own fields (up, ms) are never a value's series.
const CHECK_FIELDS = new Set(["up", "ms"]);
export function chartSeries(history, card, labelOf) {
  if (!history?.fields?.length) return [];
  const arranged = new Map((card.values || []).map((value) => [value.field, value]));
  const own = history.fields.filter((field) => card.check || !CHECK_FIELDS.has(field.field));
  // A value's colour follows its place among all the widget's numbers, so
  // picking or dropping one recolours nothing.
  const all = own.map((field, position) => ({
    field,
    index: history.fields.indexOf(field),
    arranged: arranged.get(field.field),
    name: arranged.get(field.field)?.label || labelOf(field.label || field.field),
    colour: arranged.get(field.field)?.colour || PALETTE[position % PALETTE.length],
  }));
  if (!Array.isArray(card.fields)) return all;
  return card.fields.map((key) => all.find((entry) => entry.field.field === key)).filter(Boolean);
}

// Board 27: a value that is the sum of others (a total) is never a slice of
// a pie or donut; it stands beside the chart as a number instead.
export const isTotal = (field) =>
  [field.field, field.label].some((key) => typeof key === "string" && /(^|[._-])total$/i.test(key));

// On a pie or donut a total is never a slice; it stands beside the chart.
export function besideSeries(history, card, labelOf) {
  const round = card.show === "donut" || card.show === "pie";
  if (!round) return [];
  return chartSeries(history, card, labelOf).filter((entry) => isTotal(entry.field));
}

const W = 300;
const H = 100;

function scale(series, points) {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points)
    for (const entry of series) {
      const value = point[entry.index + 1];
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
  if (!Number.isFinite(min)) return null;
  if (min > 0 && min / (max || 1) > 0.5) min = Math.max(0, min - (max - min));
  else min = Math.min(0, min);
  if (max === min) max = min + 1;
  return { min, max };
}

// Values in the same format share a scale; a percentage is drawn on its own
// 0 to 100 scale, so a rate next to a count is not pressed flat.
export function scales(series, points) {
  const groups = new Map();
  for (const entry of series) {
    const format = entry.field.format || "plain";
    if (!groups.has(format)) groups.set(format, []);
    groups.get(format).push(entry);
  }
  const out = new Map();
  for (const [format, group] of groups) {
    const range = scale(group, points);
    if (!range) continue;
    if (format === "percent") {
      range.min = Math.min(0, range.min);
      range.max = Math.max(100, range.max);
    }
    for (const entry of group) out.set(entry.field.field, range);
  }
  return out;
}

// Round numbers for an axis: about `count` steps of 1, 2, 2.5 or 5 times a
// power of ten, covering min to max.
export function niceTicks(min, max, count = 4) {
  const high0 = max > min ? max : min + 1;
  const raw = (high0 - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((value) => value >= raw * (1 - 1e-9));
  const low = Math.floor(min / step + 1e-9) * step;
  const high = Math.ceil(high0 / step - 1e-9) * step;
  const ticks = [];
  for (let i = 0; low + i * step <= high + step / 2; i++) ticks.push(Number((low + i * step).toPrecision(12)));
  return { min: ticks[0], max: ticks.at(-1), ticks };
}

// The full view's value axes (Ben, 2 Nov): lines in the same format share
// one axis; the first line's format is on the left, a second format (a
// percentage first) gets its own axis on the right. A percentage axis runs
// 0 to 100.
export function axes(series, points) {
  const groups = [];
  for (const entry of series) {
    const format = entry.field.format || "plain";
    let group = groups.find((item) => item.format === format);
    if (!group) {
      group = { format, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  const ranges = new Map();
  const shown = [];
  for (const group of groups) {
    const range = scale(group.entries, points);
    if (!range) continue;
    const nice =
      group.format === "percent" && range.min >= 0 && range.max <= 100
        ? niceTicks(0, 100, 4)
        : niceTicks(range.min, range.max);
    for (const entry of group.entries) ranges.set(entry.field.field, nice);
    shown.push({ ...group, range: nice });
  }
  // A percentage goes on the right when another unit is shown.
  if (shown.length > 1 && shown[0].format === "percent") shown.push(shown.shift());
  return { ranges, left: shown[0] || null, right: shown[1] || null };
}

// Where the collected numbers start: a chart whose history is shorter than
// its range is drawn from its first number (with a note), not as a speck at
// the right edge.
export function dataStart(series, points, from) {
  const first = points.find((point) => series.some((entry) => Number.isFinite(point[entry.index + 1])));
  if (!first) return null;
  return first[0] > from + (points.at(-1)[0] - from) * 0.05 ? first[0] : null;
}

const TIME_STEPS = [5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880, 7200, 10080].map((m) => m * 60e3);
// Time axis marks on round local times, about five across the span.
export function timeTicks(from, to) {
  const step = TIME_STEPS.find((value) => (to - from) / value <= 6) || TIME_STEPS.at(-1);
  const offset = new Date(from).getTimezoneOffset() * 60e3;
  const ticks = [];
  for (let at = Math.ceil((from + offset) / step) * step - offset; at <= to; at += step) ticks.push(at);
  return { ticks, step };
}

const fraction = (range, value) => (value - range.min) / (range.max - range.min || 1);

function Grid({ grid }) {
  if (!grid) return null;
  return (
    <g className="studio-chart-grid">
      {grid.y.map((y) => (
        <line key={`y${y}`} x1="0" x2={W} y1={H - y * H} y2={H - y * H} />
      ))}
      {grid.x.map((x) => (
        <line key={`x${x}`} x1={x * W} x2={x * W} y1="0" y2={H} />
      ))}
    </g>
  );
}

// Line and area: one path per value, gaps left open.
function Lines({ series, points, from, to, area, hover, ranges: given, grid }) {
  const ranges = given || scales(series, points);
  if (!ranges.size) return null;
  const x = (t) => ((t - from) / (to - from || 1)) * W;
  return (
    <svg className="studio-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <Grid grid={grid} />
      {series.map((entry) => {
        const range = ranges.get(entry.field.field);
        if (!range) return null;
        const y = (v) => H - fraction(range, v) * H;
        const segments = [];
        let current = [];
        for (const point of points) {
          if (point[0] < from) continue;
          const value = point[entry.index + 1];
          if (Number.isFinite(value)) current.push([x(point[0]), y(value)]);
          else if (current.length) {
            segments.push(current);
            current = [];
          }
        }
        if (current.length) segments.push(current);
        return segments.map((segment, i) => {
          // A single number is drawn as a short level line, so it shows.
          const drawn = segment.length === 1 ? [[segment[0][0] - 1.5, segment[0][1]], segment[0]] : segment;
          const line = drawn.map(([px, py], j) => `${j ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
          return (
            <g key={`${entry.field.field}-${i}`}>
              {area && (
                <path
                  d={`${line}L${drawn.at(-1)[0].toFixed(1)},${H}L${drawn[0][0].toFixed(1)},${H}Z`}
                  fill={entry.colour}
                  opacity="0.18"
                />
              )}
              <path d={line} fill="none" stroke={entry.colour} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            </g>
          );
        });
      })}
      {hover && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} className="studio-chart-cursor" />}
    </svg>
  );
}

// Bars: one group per step of the range, a bar for each value in it.
function Bars({ series, points, from, to, ranges: given, grid }) {
  const ranges = given || scales(series, points);
  const inRange = points.filter((point) => point[0] >= from);
  if (!ranges.size || !inRange.length) return null;
  const count = Math.max(1, Math.min(48, inRange.length));
  const step = (to - from) / count;
  const slot = W / count;
  const width = (slot * 0.7) / series.length;
  return (
    <svg className="studio-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <Grid grid={grid} />
      {series.map((entry, n) => {
        const range = ranges.get(entry.field.field);
        if (!range) return null;
        return Array.from({ length: count }, (_, i) => {
          const inside = inRange.filter(
            (point) =>
              Number.isFinite(point[entry.index + 1]) &&
              point[0] >= from + i * step &&
              (point[0] < from + (i + 1) * step || i === count - 1),
          );
          if (!inside.length) return null;
          const share = Math.max(0, fraction(range, inside.at(-1)[entry.index + 1]));
          return (
            <rect
              key={`${entry.field.field}-${i}`}
              x={i * slot + slot * 0.15 + n * width}
              width={width}
              y={H - share * H}
              height={share * H}
              fill={entry.colour}
              rx="1"
            />
          );
        });
      })}
    </svg>
  );
}

// Donut and pie: the latest values as parts of their total. A donut writes
// its hero's share in the middle (board 10).
function Parts({ series, latest, hole, centre }) {
  const parts = series
    .map((entry) => ({ ...entry, value: latest?.values?.[entry.field.field] }))
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0);
  const total = parts.reduce((sum, entry) => sum + entry.value, 0);
  if (!total) return null;
  // Each part starts where the ones before it end.
  const starts = parts.map(
    (_, i) => -Math.PI / 2 + (parts.slice(0, i).reduce((sum, entry) => sum + entry.value, 0) / total) * Math.PI * 2,
  );
  const arc = (start, end, r) => {
    const large = end - start > Math.PI ? 1 : 0;
    return `M${50 + r * Math.cos(start)},${50 + r * Math.sin(start)}A${r},${r} 0 ${large} 1 ${50 + r * Math.cos(end)},${50 + r * Math.sin(end)}`;
  };
  return (
    <svg className="studio-chart-round" viewBox="0 0 100 100" aria-hidden="true">
      {hole && <circle cx="50" cy="50" r="40" fill="none" className="studio-chart-track" strokeWidth="12" />}
      {parts.map((entry, i) => {
        const start = starts[i];
        const sweep = (entry.value / total) * Math.PI * 2;
        const end = start + Math.min(sweep, Math.PI * 2 - 0.0001);
        return hole ? (
          <path key={entry.field.field} d={arc(start, end, 40)} fill="none" stroke={entry.colour} strokeWidth="12" />
        ) : (
          <path key={entry.field.field} d={`M50,50L${arc(start, end, 48).slice(1)}Z`} fill={entry.colour} />
        );
      })}
      {hole && centre && (
        <>
          <text x="50" y={centre.label ? 52 : 56} textAnchor="middle" className="studio-chart-centre">
            {centre.value}
          </text>
          {centre.label && (
            <text x="50" y="65" textAnchor="middle" className="studio-chart-centre-label">
              {centre.label}
            </text>
          )}
        </>
      )}
    </svg>
  );
}

// Gauge: one percentage against 100, in its colour rule's colour, with the
// value and its name inside the arc (board 10).
function Gauge({ entry, value, text, level }) {
  const share = Math.max(0, Math.min(1, value / 100));
  const start = Math.PI;
  const end = Math.PI + share * Math.PI;
  const point = (a) => `${50 + 40 * Math.cos(a)},${52 + 40 * Math.sin(a)}`;
  const colour = level ? `var(--studio-status-${level})` : entry.colour;
  return (
    <svg className="studio-chart-gauge" viewBox="0 0 100 60" aria-hidden="true">
      <path
        d={`M${point(Math.PI)}A40,40 0 0 1 ${point(0)}`}
        fill="none"
        className="studio-chart-track"
        strokeWidth="9"
        strokeLinecap="round"
      />
      {share > 0 && (
        <path
          d={`M${point(start)}A40,40 0 0 1 ${point(end)}`}
          fill="none"
          stroke={colour}
          strokeWidth="9"
          strokeLinecap="round"
        />
      )}
      <text x="50" y="46" textAnchor="middle" className="studio-chart-centre">
        {text}
      </text>
      <text x="50" y="56" textAnchor="middle" className="studio-chart-centre-label">
        {entry.name}
      </text>
    </svg>
  );
}

function Legend({ series, latest, format, share }) {
  const total = share
    ? series.reduce((sum, entry) => {
        const value = latest?.values?.[entry.field.field];
        return sum + (Number.isFinite(value) && value > 0 ? value : 0);
      }, 0)
    : 0;
  return (
    <ul className="studio-chart-legend">
      {series.map((entry) => {
        const value = latest?.values?.[entry.field.field];
        return (
          <li key={entry.field.field}>
            <span className="studio-chart-key" style={{ background: entry.colour }} aria-hidden="true" />
            <span className="studio-chart-name">{entry.name}</span>
            {latest && (
              <strong>
                {share && total
                  ? `${Math.round(((Number.isFinite(value) ? value : 0) / total) * 100)}%`
                  : format(entry.field, value)}
              </strong>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// A screen-reader summary of what the chart shows.
function summary(series, latest, format, rangeLabel) {
  return `${rangeLabel ? `${rangeLabel}. ` : ""}${series
    .map((entry) => `${entry.name}: ${format(entry.field, latest?.values?.[entry.field.field])}`)
    .join(", ")}`;
}

// Donut and pie draw parts of a whole, so only values in one format: the
// format most of the widget's values share (the first such on a tie).
export function partsFormat(fields = []) {
  const counts = new Map();
  for (const field of fields) counts.set(field.format || "plain", (counts.get(field.format || "plain") || 0) + 1);
  let best = null;
  for (const [format, count] of counts) if (!best || count > counts.get(best)) best = format;
  return best;
}

// The value a gauge or a donut's middle shows: the block's first value, else
// (for a gauge with none picked) the first percentage.
export function heroSeries(series, gauge = false, picked = false) {
  return (!picked && gauge && series.find((entry) => entry.field.format === "percent")) || series[0];
}

// Times in the dashboard's language, like its numbers.
export function useTimeFormat() {
  const { i18n } = useTranslation();
  const locale = i18n?.language || undefined;
  const safe = (at, options) => {
    try {
      return new Date(at).toLocaleString(locale, options);
    } catch {
      return new Date(at).toLocaleString(undefined, options);
    }
  };
  return {
    time: (at) => safe(at, { hour: "2-digit", minute: "2-digit" }),
    day: (at) => safe(at, { month: "short", day: "numeric" }),
    full: (at) => safe(at, { dateStyle: "medium", timeStyle: "short" }),
  };
}

// The chart part of a card shown as a chart. The widget's live values are
// drawn by CardValues above it (except donut, pie and gauge, which write
// their own).
export function CardChart({ card, onOpen }) {
  const { t } = useTranslation();
  const format = useFormatValue();
  const when = useTimeFormat();
  const history = card.history;
  const labelOf = (label) => t(label);
  const series = useMemo(() => chartSeries(history, card, labelOf), [history, card]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!history) return <p className="studio-chart-note">Loading the chart…</p>;
  if (!series.length || !history.latest)
    return (
      <p className="studio-chart-note">
        Collecting numbers. The chart fills in as Studio records them, about once a minute.
      </p>
    );
  const show = card.show;
  const round = show === "donut" || show === "pie";
  const now = history.latest.at;
  const rangeFrom = now - (RANGE_SPAN[card.chartRange] || RANGE_SPAN["24h"]);
  const since = CHART_SHOWS.includes(show) ? dataStart(series, history.points, rangeFrom) : null;
  const from = since ?? rangeFrom;
  let body;
  if (show === "gauge") {
    const entry = heroSeries(series, true, Array.isArray(card.fields));
    const value = history.latest.values?.[entry.field.field];
    const rule = (card.values || []).find((item) => item.field === entry.field.field)?.rules;
    body = <Gauge entry={entry} value={value} text={format(entry.field, value)} level={ruleLevel(rule, value)} />;
  } else if (round) {
    const unit = partsFormat(history.fields);
    const parts = series.filter((entry) => (entry.field.format || "plain") === unit && !isTotal(entry.field));
    const hero = heroSeries(parts, false, true);
    const total = parts.reduce((sum, entry) => {
      const value = history.latest.values?.[entry.field.field];
      return sum + (Number.isFinite(value) && value > 0 ? value : 0);
    }, 0);
    const heroValue = hero ? history.latest.values?.[hero.field.field] : undefined;
    const centre =
      show === "donut" && total && Number.isFinite(heroValue)
        ? { value: `${Math.round((Math.max(0, heroValue) / total) * 100)}%`, label: hero.name }
        : null;
    body = (
      <div className="studio-chart-parts">
        <Parts series={parts} latest={history.latest} hole={show === "donut"} centre={centre} />
        <Legend series={parts} latest={history.latest} format={format} share={show === "pie"} />
      </div>
    );
  } else if (show === "bar") body = <Bars series={series} points={history.points} from={from} to={now} />;
  else body = <Lines series={series} points={history.points} from={from} to={now} area={show === "area"} />;
  const label = CHART_SHOWS.includes(show)
    ? since
      ? `Since ${when.time(since)}`
      : RANGE_LABELS[card.chartRange]
    : null;
  const beside = besideSeries(history, card, labelOf);
  const content = (
    <>
      <div className={`studio-chart studio-chart-${show}${beside.length ? " studio-chart-with-numbers" : ""}`}>
        {body}
        {beside.length > 0 && (
          <dl className="studio-chart-numbers">
            {beside.map((entry) => (
              <div key={entry.field.field}>
                <dt>{entry.name}</dt>
                <dd>{format(entry.field, history.latest.values?.[entry.field.field])}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {/* One line under the chart: the legend, then the range. */}
      {((!round && show !== "gauge" && series.length > 1) || label) && (
        <div className="studio-chart-foot">
          {!round && show !== "gauge" && series.length > 1 && (
            <Legend series={series} latest={history.latest} format={format} />
          )}
          {label && <span className="studio-chart-range">{label}</span>}
        </div>
      )}
    </>
  );
  // Charts over time open full size; the dialog adds ranges and exact values.
  return onOpen && CHART_SHOWS.includes(show) ? (
    <button
      type="button"
      className="studio-chart-open"
      onClick={onOpen}
      aria-label={`Open full view. ${summary(series, history.latest, format, label)}`}
    >
      {content}
    </button>
  ) : (
    <div className="studio-chart-wrap" role="img" aria-label={summary(series, history.latest, format, label)}>
      {content}
    </div>
  );
}

function AxisLabels({ group, side, format }) {
  const { range } = group;
  const meta = group.entries[0].field;
  const labels = range.ticks.map((value) => [value, format(meta, value)]);
  const widest = labels.reduce((best, [, text]) => (text.length > best.length ? text : best), "");
  return (
    <div className={`studio-axis studio-axis-${side}`} aria-hidden="true">
      <span className="studio-axis-sizer">{widest}</span>
      {labels.map(([value, text]) => (
        <span key={value} style={{ bottom: `${fraction(range, value) * 100}%` }}>
          {text}
        </span>
      ))}
    </div>
  );
}

function AxisKeys({ group, side }) {
  return (
    <div className={`studio-axis-keys studio-axis-keys-${side}`} aria-hidden="true">
      {group.entries.map((entry) => (
        <span key={entry.field.field} className="studio-chart-key" style={{ background: entry.colour }} />
      ))}
    </div>
  );
}

// Full view (board 15): a chart widget full size, with value and time axes,
// a time range and the exact values under the pointer.
export function ChartFullView({ panel, card, title, ranges = Object.keys(RANGE_LABELS), onClose }) {
  const { t } = useTranslation();
  const format = useFormatValue();
  const when = useTimeFormat();
  const [range, setRange] = useState(card.chartRange || "24h");
  const [hover, setHover] = useState(null);
  const id = useId();
  const { data: history } = useSWR(historyPath(panel.id, range), studioRequest, { refreshInterval: 60000 });
  const series = useMemo(() => chartSeries(history, card, (label) => t(label)), [history, card, t]);
  const points = useMemo(() => history?.points || [], [history]);
  const now = history?.latest?.at ?? 0;
  const since = series.length ? dataStart(series, points, now - RANGE_SPAN[range]) : null;
  const from = since ?? now - RANGE_SPAN[range];
  const span = now - from || 1;
  const point = hover !== null ? points[hover] : null;
  const pick = (event) => {
    if (!points.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = from + ((event.clientX - box.left) / box.width) * span;
    let best = -1;
    points.forEach((p, i) => {
      if (p[0] >= from && (best < 0 || Math.abs(p[0] - at) < Math.abs(points[best][0] - at))) best = i;
    });
    setHover(best < 0 ? null : best);
  };
  const scaled = useMemo(() => axes(series, points), [series, points]);
  const time = timeTicks(from, now);
  const timeText = (at) => (time.step >= 86400e3 ? when.day(at) : when.time(at));
  const grid = scaled.left
    ? {
        y: scaled.left.range.ticks.map((value) => fraction(scaled.left.range, value)),
        x: time.ticks.map((at) => (at - from) / span),
      }
    : null;
  return (
    <StudioDialog title={title} eyebrow="Full view" onClose={onClose} wide>
      <div className="studio-dialog-body studio-full-view">
        <Segmented
          label="Time range"
          value={range}
          onChange={setRange}
          options={ranges.map((key) => [key, key.replace(/(\d)([hd])/, "$1 $2")])}
        />
        {!history ? (
          <p className="studio-chart-note">Loading…</p>
        ) : !series.length || !scaled.left ? (
          <p className="studio-chart-note">No history for this range yet.</p>
        ) : (
          <>
            <div className={`studio-full-plot${scaled.right ? " has-right" : ""}`}>
              {scaled.right && <AxisKeys group={scaled.left} side="left" />}
              {scaled.right && <AxisKeys group={scaled.right} side="right" />}
              <AxisLabels group={scaled.left} side="left" format={format} />
              {/* The chart is described by the values list below it. */}
              <div
                className="studio-full-chart"
                onPointerMove={pick}
                onPointerLeave={() => setHover(null)}
                aria-describedby={id}
              >
                {card.show === "bar" ? (
                  <Bars series={series} points={points} from={from} to={now} ranges={scaled.ranges} grid={grid} />
                ) : (
                  <Lines
                    series={series}
                    points={points}
                    from={from}
                    to={now}
                    area={card.show === "area"}
                    hover={point?.[0]}
                    ranges={scaled.ranges}
                    grid={grid}
                  />
                )}
              </div>
              {scaled.right && <AxisLabels group={scaled.right} side="right" format={format} />}
              <div className="studio-axis-time" aria-hidden="true">
                {time.ticks.map((at) => {
                  const where = (at - from) / span;
                  return (
                    <span
                      key={at}
                      style={{
                        left: `${where * 100}%`,
                        transform: `translateX(${where < 0.06 ? 0 : where > 0.94 ? -100 : -50}%)`,
                      }}
                    >
                      {timeText(at)}
                    </span>
                  );
                })}
              </div>
            </div>
            {since && (
              <p className="studio-muted studio-chart-since">
                Collecting since {when.full(since)}. The chart widens to the full range as Studio records more.
              </p>
            )}
            <div id={id} aria-live="polite">
              <p className="studio-muted">
                {point ? when.full(point[0]) : "Now · point at the chart for exact values"}
              </p>
              <Legend
                series={series}
                latest={
                  point
                    ? {
                        values: Object.fromEntries(series.map((entry) => [entry.field.field, point[entry.index + 1]])),
                      }
                    : history.latest
                }
                format={format}
              />
            </div>
          </>
        )}
      </div>
    </StudioDialog>
  );
}

// Status history (board 13): a bar for each status check in the last hour,
// up or down, and the share of checks that were up over the chosen range.
const BARS = 60;
export function uptimeOf(history) {
  const index = history?.fields?.findIndex((field) => field.field === "up");
  if (index === undefined || index < 0) return null;
  const values = history.points.map((point) => point[index + 1]).filter(Number.isFinite);
  if (!values.length) return null;
  return (values.reduce((sum, value) => sum + value, 0) / values.length) * 100;
}

export function statusBars(history) {
  const up = history?.fields?.findIndex((field) => field.field === "up");
  if (up === undefined || up < 0) return [];
  const ms = history.fields.findIndex((field) => field.field === "ms");
  return history.points
    .filter((point) => Number.isFinite(point[up + 1]))
    .slice(-BARS)
    .map((point) => ({ at: point[0], up: point[up + 1] >= 0.5, ms: ms >= 0 ? point[ms + 1] : null }));
}

export function StatusHistory({ card }) {
  const when = useTimeFormat();
  const range = card.chartRange || "24h";
  const { data: recent } = useSWR(card.id ? historyPath(card.id, "1h") : null, studioRequest, {
    refreshInterval: 60000,
  });
  const { data: longer } = useSWR(card.id && range !== "1h" ? historyPath(card.id, range) : null, studioRequest, {
    refreshInterval: 60000,
  });
  if (!recent) return <p className="studio-chart-note">Loading the status history…</p>;
  const bars = statusBars(recent);
  if (!bars.length)
    return <p className="studio-chart-note">Collecting checks. A bar appears for each one, about once a minute.</p>;
  const uptime = uptimeOf(range === "1h" ? recent : longer);
  const time = when.time;
  const words = (bar) => `${time(bar.at)}: ${bar.up ? `Up${Number.isFinite(bar.ms) ? `, ${bar.ms} ms` : ""}` : "Down"}`;
  const down = bars.filter((bar) => !bar.up).length;
  return (
    <div className="studio-status-history">
      <div
        className="studio-status-bars"
        role="img"
        aria-label={`Last ${bars.length} checks: ${down ? `${down} down` : "all up"}`}
      >
        {bars.map((bar) => (
          <span key={bar.at} className={bar.up ? "is-up" : "is-down"} title={words(bar)} />
        ))}
      </div>
      {uptime !== null && (
        <span className="studio-status-uptime">
          {uptime >= 99.95 || uptime === 0 ? Math.round(uptime) : uptime.toFixed(1)}% up · {RANGE_LABELS[range]}
        </span>
      )}
    </div>
  );
}
