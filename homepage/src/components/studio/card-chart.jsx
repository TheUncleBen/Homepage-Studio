import { useTranslation } from "next-i18next/pages";
import { useId, useMemo, useState } from "react";
import useSWR from "swr";

import { studioRequest } from "./api.mjs";
import { dashboardPath } from "./dashboard-path.mjs";
import StudioDialog from "./dialog";
import { CHART_SHOWS, needsHistory, ruleLevel } from "./look.mjs";
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

// The range a card reads: its chart's, or long enough for its trend.
export function historyRange(look) {
  if (CHART_SHOWS.includes(look.show)) return look.chartRange;
  if (look.show === "numbers" && look.layout === "hero" && look.trend === "week") return "30d";
  if (look.show === "numbers" && look.layout === "hero" && look.trend === "day") return "7d";
  if (look.show === "numbers" && look.layout === "hero" && look.trend === "hour") return "6h";
  return "1h";
}

export function useCardHistory(panel, look) {
  const wanted = panel?.kind === "serviceWidget" && Boolean(panel.id) && needsHistory(look);
  const { data } = useSWR(wanted ? historyPath(panel.id, historyRange(look)) : null, studioRequest, {
    refreshInterval: 60000,
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

// Which of the history's values a chart draws: the ones the widget shows, in
// its order, with their own names and colours.
export function chartSeries(history, card, labelOf) {
  if (!history?.fields?.length) return [];
  const arranged = new Map((card.values || []).map((value, order) => [value.field, { ...value, order }]));
  return history.fields
    .map((field, index) => ({ field, index, arranged: arranged.get(field.field) }))
    .filter((entry) => entry.arranged?.slot !== "hidden")
    .sort((a, b) => (a.arranged?.order ?? Infinity) - (b.arranged?.order ?? Infinity))
    .map((entry, position) => ({
      ...entry,
      name: entry.arranged?.label || labelOf(entry.field.label || entry.field.field),
      colour: entry.arranged?.colour || PALETTE[position % PALETTE.length],
    }));
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

// Line and area: one path per value, gaps left open.
function Lines({ series, points, from, to, area, hover }) {
  const ranges = scales(series, points);
  if (!ranges.size) return null;
  const x = (t) => ((t - from) / (to - from || 1)) * W;
  return (
    <svg className="studio-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {series.map((entry) => {
        const range = ranges.get(entry.field.field);
        if (!range) return null;
        const y = (v) => H - ((v - range.min) / (range.max - range.min)) * H;
        const segments = [];
        let current = [];
        for (const point of points) {
          const value = point[entry.index + 1];
          if (Number.isFinite(value)) current.push([x(point[0]), y(value)]);
          else if (current.length) {
            segments.push(current);
            current = [];
          }
        }
        if (current.length) segments.push(current);
        return segments.map((segment, i) => {
          const line = segment.map(([px, py], j) => `${j ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
          return (
            <g key={`${entry.field.field}-${i}`}>
              {area && (
                <path
                  d={`${line}L${segment.at(-1)[0].toFixed(1)},${H}L${segment[0][0].toFixed(1)},${H}Z`}
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

// Bars: the first value, one bar per step of the range.
function Bars({ series, points, from, to }) {
  const entry = series[0];
  const values = points.filter((point) => Number.isFinite(point[entry.index + 1]));
  const range = scale([entry], values);
  if (!range || !values.length) return null;
  const count = Math.min(48, values.length);
  const step = (to - from) / count;
  const buckets = Array.from({ length: count }, (_, i) => {
    const inside = values.filter((point) => point[0] >= from + i * step && point[0] < from + (i + 1) * step);
    return inside.length ? inside.at(-1)[entry.index + 1] : null;
  });
  const width = W / count;
  return (
    <svg className="studio-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {buckets.map((value, i) =>
        Number.isFinite(value) ? (
          <rect
            key={i}
            x={i * width + width * 0.15}
            width={width * 0.7}
            y={H - ((value - range.min) / (range.max - range.min)) * H}
            height={((value - range.min) / (range.max - range.min)) * H}
            fill={entry.colour}
            rx="1"
          />
        ) : null,
      )}
    </svg>
  );
}

// Donut and pie: the latest values as parts of their total.
function Parts({ series, latest, hole }) {
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
      {parts.map((entry, i) => {
        const start = starts[i];
        const sweep = (entry.value / total) * Math.PI * 2;
        const end = start + Math.min(sweep, Math.PI * 2 - 0.0001);
        return hole ? (
          <path key={entry.field.field} d={arc(start, end, 38)} fill="none" stroke={entry.colour} strokeWidth="16" />
        ) : (
          <path key={entry.field.field} d={`M50,50L${arc(start, end, 46).slice(1)}Z`} fill={entry.colour} />
        );
      })}
    </svg>
  );
}

// Gauge: one percentage against 100, in its colour rule's colour.
function Gauge({ entry, value, level }) {
  const share = Math.max(0, Math.min(1, value / 100));
  const start = Math.PI;
  const end = Math.PI + share * Math.PI;
  const point = (a) => `${50 + 40 * Math.cos(a)},${50 + 40 * Math.sin(a)}`;
  const colour = level ? `var(--studio-status-${level})` : entry.colour;
  return (
    <svg className="studio-chart-gauge" viewBox="0 0 100 56" aria-hidden="true">
      <path
        d={`M${point(Math.PI)}A40,40 0 0 1 ${point(0)}`}
        fill="none"
        className="studio-chart-track"
        strokeWidth="10"
      />
      {share > 0 && (
        <path d={`M${point(start)}A40,40 0 0 1 ${point(end)}`} fill="none" stroke={colour} strokeWidth="10" />
      )}
    </svg>
  );
}

function Legend({ series, latest, format }) {
  return (
    <ul className="studio-chart-legend">
      {series.map((entry) => (
        <li key={entry.field.field}>
          <span className="studio-chart-key" style={{ background: entry.colour }} aria-hidden="true" />
          {entry.name}
          {latest && <strong>{format(entry.field, latest.values?.[entry.field.field])}</strong>}
        </li>
      ))}
    </ul>
  );
}

// A screen-reader summary of what the chart shows.
function summary(series, latest, format, rangeLabel) {
  return `${rangeLabel ? `${rangeLabel}. ` : ""}${series
    .map((entry) => `${entry.name}: ${format(entry.field, latest?.values?.[entry.field.field])}`)
    .join(", ")}`;
}

// The chart part of a card shown as a chart. The widget's live values are
// drawn by CardValues above it.
export function CardChart({ card, onOpen }) {
  const { t } = useTranslation();
  const format = useFormatValue();
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
  const from = now - (RANGE_SPAN[card.chartRange] || RANGE_SPAN["24h"]);
  let body;
  if (show === "gauge") {
    const entry = series.find((item) => item.field.format === "percent") || series[0];
    const value = history.latest.values?.[entry.field.field];
    const rule = (card.values || []).find((item) => item.field === entry.field.field)?.rules;
    body = (
      <div className="studio-chart-gauge-wrap">
        <Gauge entry={entry} value={value} level={ruleLevel(rule, value)} />
        <span className="studio-chart-gauge-value">{format(entry.field, value)}</span>
      </div>
    );
  } else if (round) body = <Parts series={series} latest={history.latest} hole={show === "donut"} />;
  else if (show === "bar") body = <Bars series={series} points={history.points} from={from} to={now} />;
  else body = <Lines series={series} points={history.points} from={from} to={now} area={show === "area"} />;
  const label = CHART_SHOWS.includes(show) ? RANGE_LABELS[card.chartRange] : null;
  const content = (
    <>
      <div className={`studio-chart studio-chart-${show}`}>{body}</div>
      {(round || series.length > 1) && <Legend series={series} latest={history.latest} format={format} />}
      {label && <span className="studio-chart-range">{label}</span>}
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

// Full view (board 15): a chart widget full size, with a time range and the
// exact values under the pointer.
export function ChartFullView({ panel, card, title, ranges = Object.keys(RANGE_LABELS), onClose }) {
  const { t } = useTranslation();
  const format = useFormatValue();
  const [range, setRange] = useState(card.chartRange || "24h");
  const [hover, setHover] = useState(null);
  const id = useId();
  const { data: history } = useSWR(historyPath(panel.id, range), studioRequest, { refreshInterval: 60000 });
  const series = useMemo(() => chartSeries(history, card, (label) => t(label)), [history, card, t]);
  const now = history?.latest?.at ?? 0;
  const span = RANGE_SPAN[range];
  const from = now - span;
  const point = hover !== null ? history?.points?.[hover] : null;
  const pick = (event) => {
    if (!history?.points?.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = from + ((event.clientX - box.left) / box.width) * span;
    let best = 0;
    history.points.forEach((p, i) => {
      if (Math.abs(p[0] - at) < Math.abs(history.points[best][0] - at)) best = i;
    });
    setHover(best);
  };
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
        ) : !series.length ? (
          <p className="studio-chart-note">No history for this range yet.</p>
        ) : (
          <>
            {/* The chart is described by the values list below it. */}
            <div
              className="studio-full-chart"
              onPointerMove={pick}
              onPointerLeave={() => setHover(null)}
              aria-describedby={id}
            >
              {card.show === "bar" ? (
                <Bars series={series} points={history.points} from={from} to={now} />
              ) : (
                <Lines
                  series={series}
                  points={history.points}
                  from={from}
                  to={now}
                  area={card.show === "area"}
                  hover={point?.[0]}
                />
              )}
            </div>
            <div id={id} aria-live="polite">
              <p className="studio-muted">
                {point
                  ? new Date(point[0]).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
                  : "Now · point at the chart for exact values"}
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
