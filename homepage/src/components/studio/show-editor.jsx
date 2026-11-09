import { useTranslation } from "next-i18next/pages";
import { useRef, useState } from "react";

import { blockFields } from "./card-values";
import StudioIcon from "./icons";
import {
  BLOCK_DEFAULTS,
  BLOCK_OPTIONS,
  BLOCK_TYPES,
  COLLECTED_BLOCKS,
  DEFAULT_BLOCKS,
  MAX_BLOCKS,
  SIZE_CLASSES,
  VALUE_BLOCKS,
  setOverride,
} from "./look.mjs";
import { Group, Row, Segmented, Select, Switch } from "./ui";

// Show (widget redesign, mock-ups v4, approved 9 Nov 2026): a widget is a
// stack of blocks you compose. Each block card says what it is, which values
// it shows (drag to reorder, x to take one out, + Value to add one) and its
// own options. "Settings for" picks All sizes or one kind of size, which can
// have its own blocks and layout; anything a size doesn't set follows All sizes.

export const BLOCK_NAMES = {
  big: "Big number",
  numbers: "Numbers",
  quiet: "Quiet numbers",
  pie: "Pie chart",
  bars: "Bars",
  chart: "Chart over time",
  gauge: "Gauge",
  response: "Response time",
  status: "Status history",
  logs: "Recent logs",
};
const BLOCK_DETAILS = {
  big: "Large, one or more values",
  numbers: "Grid, list or row",
  quiet: "Small and muted, wrapped",
  pie: "Pie or donut of the numbers you pick",
  bars: "Each number as a bar",
  chart: "Line, area or bars over time",
  gauge: "One percentage against 100",
  response: "Line of the status check's times",
  status: "Up and down, check by check",
  logs: "This widget's latest log lines",
};
export const SIZE_NAMES = { small: "Small", wide: "Wide", tall: "Tall", regular: "Regular", large: "Large" };
const SIZE_HINTS = {
  small: "under 260 px both ways",
  wide: "at least 2.2 times wider than tall",
  tall: "taller than wide (0.75 or less)",
  regular: "everything in between",
  large: "at least 300 px both ways",
};
const ARRANGE_NAMES = { auto: "Auto", grid: "Grid", list: "List", row: "Row" };
const RANGE_CHOICES = [
  ["1h", "1 h"],
  ["6h", "6 h"],
  ["24h", "24 h"],
  ["7d", "7 d"],
  ["30d", "30 d"],
];

const newId = () => Math.random().toString(36).slice(2, 10);

// Reading and writing the look at the size being edited.
export function scoped(look = {}, inheritedLook = {}, scope = "all") {
  const effective = { ...inheritedLook, ...look };
  const own = scope !== "all" ? look.sizes?.[scope] || {} : null;
  const read = (key) => (own && Object.hasOwn(own, key) ? own[key] : effective[key]);
  const ownKey = (key) => Boolean(own && Object.hasOwn(own, key));
  const write = (key, value) => {
    if (scope === "all") {
      // The default blocks are stored as nothing (Rule 2).
      if (key === "blocks" && JSON.stringify(value) === JSON.stringify(DEFAULT_BLOCKS))
        return setOverride(look, key, undefined, inheritedLook);
      return setOverride(look, key, value, inheritedLook);
    }
    const base = key === "blocks" ? effective.blocks || DEFAULT_BLOCKS : effective[key];
    const one = { ...(look.sizes?.[scope] || {}) };
    if (value === undefined || JSON.stringify(value) === JSON.stringify(base)) delete one[key];
    else one[key] = value;
    const sizes = { ...(look.sizes || {}) };
    if (Object.keys(one).length) sizes[scope] = one;
    else delete sizes[scope];
    return setOverride(look, "sizes", Object.keys(sizes).length ? sizes : undefined, inheritedLook);
  };
  return { read, write, ownKey };
}

// "Settings for": All sizes or one kind of size, with a dot on sizes that
// have their own settings and "now" on the size the widget is at.
export function SizeBar({ look = {}, scope, onScope, now, onUseAll }) {
  const own = (key) => Boolean(look.sizes?.[key] && Object.keys(look.sizes[key]).length);
  return (
    <div className="studio-sizebar">
      <span className="studio-sizebar-label" id="studio-sizebar-label">
        Settings for
      </span>
      <div className="studio-sizebar-row" role="group" aria-labelledby="studio-sizebar-label">
        {["all", ...SIZE_CLASSES].map((key) => (
          <button
            key={key}
            type="button"
            className="studio-size-button"
            aria-pressed={scope === key}
            onClick={() => onScope(key)}
          >
            {key === "all" ? "All sizes" : SIZE_NAMES[key]}
            {key !== "all" && own(key) && <i className="studio-size-own" aria-label="has its own settings" />}
            {key === now && <em>now</em>}
          </button>
        ))}
      </div>
      <p className="studio-sizebar-note">
        {scope === "all" ? (
          SIZE_CLASSES.some(own) ? (
            "Sizes marked with a dot have their own settings, which win at that size."
          ) : (
            "One layout for every size. Pick a size to give it its own settings."
          )
        ) : (
          <>
            <b>{SIZE_NAMES[scope]}</b> ({SIZE_HINTS[scope]}). Changes here only apply at this size; everything else
            follows All sizes.{" "}
            {own(scope) && (
              <button type="button" className="studio-text-button" onClick={onUseAll}>
                Use All sizes here
              </button>
            )}
          </>
        )}
      </p>
    </div>
  );
}

// The numbers a chart block can draw (Rule 1): a pie or bars compare numbers
// written the same way (counts with counts, not with milliseconds), a gauge
// shows a percentage, a chart over time takes any (each unit its own axis).
// Without the formats yet, every number.
export function chartPool(type, numbers, formats = {}, picked = []) {
  if (type === "chart" || !numbers.some((key) => formats[key])) return numbers;
  if (type === "gauge") return numbers.filter((key) => formats[key] === "percent");
  let unit = picked.length ? formats[picked[0]] : undefined;
  if (!unit) {
    const counts = new Map();
    for (const key of numbers) counts.set(formats[key], (counts.get(formats[key]) || 0) + 1);
    unit = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  return numbers.filter((key) => formats[key] === unit);
}

// Values a new block starts with: charts take the numbers they can draw, a
// Big number the first value no other block shows, the rest whatever isn't
// shown yet.
export function startValues(type, keys, numbers, blocks, formats = {}) {
  if (!VALUE_BLOCKS.includes(type)) return undefined;
  const used = new Set(blocks.flatMap((block) => (Array.isArray(block.values) ? block.values : [])));
  const pool = COLLECTED_BLOCKS.includes(type) ? chartPool(type, numbers, formats) : keys;
  if (type === "big") {
    const free = pool.find((key) => !used.has(key)) ?? pool[0];
    return free ? [free] : [];
  }
  if (type === "gauge") return pool.slice(0, 1);
  if (COLLECTED_BLOCKS.includes(type)) return pool.slice(0, 4);
  const free = pool.filter((key) => !used.has(key));
  return free.length ? free : [...pool];
}

// Values in a block reorder by dragging (or the arrow keys on a focused one).
function ValueChips({ block, keys, names, numbers, formats, onChange, label }) {
  const wrap = useRef(null);
  const [drag, setDrag] = useState(null);
  const many = keys.length > 1;
  const pool = COLLECTED_BLOCKS.includes(block.type) ? chartPool(block.type, numbers, formats, keys) : null;
  const left = Object.keys(names).filter((key) => !keys.includes(key) && (!pool || pool.includes(key)));
  const move = (from, to) => {
    if (to < 0 || to >= keys.length || from === to) return;
    const next = [...keys];
    const [key] = next.splice(from, 1);
    next.splice(to, 0, key);
    onChange(next);
  };
  const start = (event, from) => {
    if (!many || event.target.closest("button")) return;
    event.preventDefault();
    const chip = event.currentTarget;
    chip.setPointerCapture?.(event.pointerId);
    const chips = [...wrap.current.querySelectorAll(".studio-chip-value")];
    let to = from;
    const sx = event.clientX;
    const sy = event.clientY;
    setDrag({ from, to, dx: 0, dy: 0 });
    const moveTo = (ev) => {
      to = from;
      chips.forEach((other, index) => {
        if (other === chip) return;
        const box = other.getBoundingClientRect();
        if (
          ev.clientX >= box.left &&
          ev.clientX <= box.right &&
          ev.clientY >= box.top - 3 &&
          ev.clientY <= box.bottom + 3
        )
          to = index;
      });
      setDrag({ from, to, dx: ev.clientX - sx, dy: ev.clientY - sy });
    };
    const end = () => {
      chip.removeEventListener("pointermove", moveTo);
      chip.removeEventListener("pointerup", end);
      chip.removeEventListener("pointercancel", end);
      setDrag(null);
      move(from, to);
    };
    chip.addEventListener("pointermove", moveTo);
    chip.addEventListener("pointerup", end);
    chip.addEventListener("pointercancel", end);
  };
  return (
    <div className="studio-block-chips" ref={wrap} role="group" aria-label={`Values in ${label}`}>
      {keys.map((key, index) => (
        <span
          key={key}
          className="studio-chip-value"
          data-drag={drag?.from === index ? "" : undefined}
          data-drop={drag && drag.to === index && drag.from !== index ? "" : undefined}
          style={drag?.from === index ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
          tabIndex={many ? 0 : undefined}
          aria-label={
            many
              ? `${names[key] || key}, ${index + 1} of ${keys.length}. Drag, or use the arrow keys, to move it.`
              : undefined
          }
          onPointerDown={(event) => start(event, index)}
          onKeyDown={(event) => {
            const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
            if (!many || !step) return;
            event.preventDefault();
            move(index, index + step);
          }}
        >
          <span>{names[key] || key}</span>
          <button
            type="button"
            className="studio-chip-remove"
            aria-label={`Take ${names[key] || key} out of ${label}`}
            onClick={() => onChange(keys.filter((item) => item !== key))}
          >
            <StudioIcon name="close" size={12} />
          </button>
        </span>
      ))}
      {left.length > 0 && !(block.type === "gauge" && keys.length) && (
        <Select
          className="studio-chip-add"
          label={`Add a value to ${label}`}
          placeholder="+ Value"
          value=""
          options={left.map((key) => [key, names[key] || key])}
          onChange={(key) => onChange(block.type === "gauge" ? [key] : [...keys, key])}
        />
      )}
    </div>
  );
}

function BlockCard({
  block,
  index,
  count,
  least,
  keys,
  names,
  numbers,
  formats,
  types,
  autoNow,
  onChange,
  onType,
  onMove,
  onRemove,
  own,
}) {
  const name = BLOCK_NAMES[block.type];
  const options = BLOCK_OPTIONS[block.type];
  const set = (key, value) => onChange({ ...block, [key]: value });
  const value = (key) => block[key] ?? BLOCK_DEFAULTS[block.type][key];
  return (
    <section className="studio-block-card" data-key={`block-${block.id}`} aria-label={`Block ${index + 1}: ${name}`}>
      <header className="studio-block-card-head">
        <Select
          label={`Block ${index + 1}: what it shows`}
          value={block.type}
          options={[...new Set([...types, block.type])].map((type) => [type, BLOCK_NAMES[type], BLOCK_DETAILS[type]])}
          onChange={onType}
        />
        {own && <span className="studio-own-tag">this size</span>}
        <span className="studio-block-card-tools">
          {count > 1 && (
            <>
              <button
                type="button"
                className="studio-icon-button"
                aria-label={`Move ${name} up`}
                disabled={index === 0}
                onClick={() => onMove(-1)}
              >
                <StudioIcon name="chevronUp" size={14} />
              </button>
              <button
                type="button"
                className="studio-icon-button"
                aria-label={`Move ${name} down`}
                disabled={index === count - 1}
                onClick={() => onMove(1)}
              >
                <StudioIcon name="chevronDown" size={14} />
              </button>
            </>
          )}
          <button
            type="button"
            className="studio-icon-button"
            aria-label={`Remove ${name}`}
            title={count <= least ? "A widget shows at least one block" : undefined}
            disabled={count <= least}
            onClick={onRemove}
          >
            <StudioIcon name="close" size={14} />
          </button>
        </span>
      </header>
      {VALUE_BLOCKS.includes(block.type) && (
        <ValueChips
          block={block}
          keys={keys}
          names={names}
          numbers={numbers}
          formats={formats}
          label={name}
          onChange={(values) => onChange({ ...block, values, first: undefined })}
        />
      )}
      {block.type === "numbers" && (
        <>
          <Row label="Arrangement" info="Auto picks from the widget's shape and says what it picked.">
            <Segmented
              label="Arrangement"
              value={value("arrange")}
              onChange={(next) => set("arrange", next)}
              options={options.arrange.map((key) => [
                key,
                key === "auto" ? autoNow("arrange", block) : ARRANGE_NAMES[key],
              ])}
            />
          </Row>
          {value("arrange") !== "row" && (
            <Row label="Columns">
              <Segmented
                label="Columns"
                value={value("columns")}
                onChange={(next) => set("columns", next)}
                options={options.columns.map((key) => [key, key === "auto" ? autoNow("columns", block) : key])}
              />
            </Row>
          )}
        </>
      )}
      {block.type === "big" && (
        <>
          <Row label="Largest size" info="A Big number grows to its room up to this size.">
            <Segmented
              label="Largest size"
              value={value("size")}
              onChange={(next) => set("size", next)}
              options={["s", "m", "l", "xl"].map((key) => [key, key.toUpperCase()])}
            />
          </Row>
          <Row label="Trend" info="The change since an hour, a day or a week ago, under the first value.">
            <Segmented
              label="Trend"
              value={value("trend")}
              onChange={(next) => set("trend", next)}
              options={[
                ["off", "Off"],
                ["hour", "Hour"],
                ["day", "Day"],
                ["week", "Week"],
              ]}
            />
          </Row>
        </>
      )}
      {block.type === "pie" && (
        <>
          <Row label="Style">
            <Segmented
              label="Pie style"
              value={value("style")}
              onChange={(next) => set("style", next)}
              options={[
                ["donut", "Donut"],
                ["pie", "Pie"],
              ]}
            />
          </Row>
          <Row label="Legend">
            <Segmented
              label="Legend"
              value={value("legend")}
              onChange={(next) => set("legend", next)}
              options={[
                ["auto", autoNow("legend", block)],
                ["beside", "Beside"],
                ["below", "Below"],
                ["off", "Off"],
              ]}
            />
          </Row>
        </>
      )}
      {block.type === "chart" && (
        <Row label="Style">
          <Segmented
            label="Chart style"
            value={value("style")}
            onChange={(next) => set("style", next)}
            options={[
              ["line", "Line"],
              ["area", "Area"],
              ["bar", "Bars"],
            ]}
          />
        </Row>
      )}
      {["chart", "response", "status"].includes(block.type) && (
        <Row label={block.type === "status" ? "Uptime over" : "Time range"}>
          <Segmented
            label={block.type === "status" ? "Uptime over" : "Time range"}
            value={value("range")}
            onChange={(next) => set("range", next)}
            options={RANGE_CHOICES}
          />
        </Row>
      )}
      {Object.hasOwn(options, "labels") && (
        <Row label="Labels">
          <Switch label={`${name}: show labels`} checked={value("labels")} onChange={(next) => set("labels", next)} />
        </Row>
      )}
      {block.type === "logs" && (
        <p className="studio-block-card-note">
          Only people who can read this dashboard&apos;s logs see this block. It never shows with sign-in off.
        </p>
      )}
      {["response", "status"].includes(block.type) && (
        <p className="studio-block-card-note">From the widget&apos;s status check (Behaviour).</p>
      )}
    </section>
  );
}

// fields: the values the widget draws ([{ field, label }]); numbers: the ones
// Studio can collect as numbers (charts can only use these); fit: the live
// card's last fit (Auto shows what it picked).
export default function ShowEditor({
  kind = "serviceWidget",
  look = {},
  inheritedLook = {},
  onLook,
  fields = [],
  numbers,
  formats = {},
  fit,
  scope,
  onScope,
  choices = [],
  prefix = "",
  nativeFields,
  onNativeFields,
}) {
  const { t } = useTranslation();
  const { read, write, ownKey } = scoped(look, inheritedLook, scope);
  const valued = kind === "serviceWidget";
  const stored = read("blocks");
  // A service tile has no values, so only its status, response time and logs
  // blocks are listed (and it can have none: just its header).
  const blocks = (Array.isArray(stored) ? stored : DEFAULT_BLOCKS).filter(
    (block) => valued || !VALUE_BLOCKS.includes(block.type),
  );
  // Every value the widget can show: those it draws, then its other choices.
  const names = {};
  for (const field of fields) names[field.field] = t(field.label || field.field);
  for (const choice of choices) {
    const key = `${prefix}.${choice}`;
    if (!names[key]) names[key] = t(key);
  }
  const drawn = fields.map((field) => field.field);
  const numberKeys = Array.isArray(numbers) ? numbers : Object.keys(names);
  const resolved = blockFields(blocks, drawn, numberKeys);
  // Only what can apply (Rule 1): a pie needs two numbers written the same
  // way, bars one number, a gauge a percentage.
  const offered = BLOCK_TYPES.filter((type) => {
    if (!VALUE_BLOCKS.includes(type)) return true;
    if (!valued) return false;
    if (!COLLECTED_BLOCKS.includes(type)) return true;
    return chartPool(type, numberKeys, formats).length >= (type === "pie" ? 2 : 1);
  });
  // Values a block asks for that the widget isn't drawing yet join its fields
  // list, so the widget fetches them (board 27).
  const syncNative = (next) => {
    if (!onNativeFields || !choices.length) return;
    const wanted = new Set(next.flatMap((block) => (Array.isArray(block.values) ? block.values : [])));
    const missing = [...wanted].filter((key) => !drawn.includes(key) && key.startsWith(`${prefix}.`));
    if (!missing.length) return;
    const native = (key) => key.slice(prefix.length + 1);
    const current = nativeFields?.length ? nativeFields : drawn.map(native).filter((key) => choices.includes(key));
    onNativeFields([...new Set([...current, ...missing.map(native)])]);
  };
  const commit = (next) => {
    syncNative(next);
    onLook(write("blocks", !valued && !next.length && scope === "all" ? undefined : next));
  };
  const update = (index, block) => {
    const clean = Object.fromEntries(
      Object.entries(block).filter(
        ([key, value]) =>
          value !== undefined &&
          (!Object.hasOwn(BLOCK_DEFAULTS[block.type], key) || BLOCK_DEFAULTS[block.type][key] !== value),
      ),
    );
    commit(blocks.map((item, position) => (position === index ? clean : item)));
  };
  const autoNow = (what, block) => {
    const position = fit?.blocks?.findIndex((item) => item.id === block.id) ?? -1;
    const variant = position >= 0 ? fit.pick?.variants?.[position] : null;
    if (!variant) return "Auto";
    const now =
      what === "arrange"
        ? ARRANGE_NAMES[variant.arrange]
        : what === "columns"
          ? variant.arrange === "row"
            ? null
            : String(variant.columns)
          : what === "legend"
            ? variant.legend
            : null;
    return now ? (
      <>
        Auto <span className="studio-auto-now">· {now}</span>
      </>
    ) : (
      "Auto"
    );
  };
  const dirNow =
    fit?.pick && blocks.length > 1 ? (
      <>
        Auto{" "}
        <span className="studio-auto-now">
          · {fit.pick.dir === "row" ? "side by side" : fit.pick.dir === "grid" ? "grid" : "stacked"}
        </span>
      </>
    ) : (
      "Auto"
    );
  const arrange = read("arrange") || "auto";
  return (
    <div className="studio-show-editor">
      <SizeBar
        look={look}
        scope={scope}
        onScope={onScope}
        now={fit?.sizeClass}
        onUseAll={() => {
          const sizes = { ...(look.sizes || {}) };
          delete sizes[scope];
          onLook(setOverride(look, "sizes", Object.keys(sizes).length ? sizes : undefined, inheritedLook));
        }}
      />
      <Group
        title="Blocks"
        info="Each block shows the values you pick, in its own look. The same value can sit in more than one block. Drag a value to change its order."
      >
        {blocks.map((block, index) => (
          <BlockCard
            key={block.id}
            block={block}
            index={index}
            count={blocks.length}
            least={valued ? 1 : 0}
            keys={resolved[block.id] || []}
            names={names}
            numbers={numberKeys}
            formats={formats}
            types={offered}
            own={ownKey("blocks")}
            autoNow={autoNow}
            onChange={(next) => update(index, next)}
            onType={(type) => {
              const kept = { id: block.id, type };
              if (block.labels === false && Object.hasOwn(BLOCK_OPTIONS[type], "labels")) kept.labels = false;
              if (VALUE_BLOCKS.includes(type)) {
                let values = resolved[block.id] || [];
                if (COLLECTED_BLOCKS.includes(type)) {
                  const pool = chartPool(
                    type,
                    numberKeys,
                    formats,
                    values.filter((key) => numberKeys.includes(key)),
                  );
                  values = values.filter((key) => pool.includes(key));
                }
                if (type === "gauge") values = values.slice(0, 1);
                if (!values.length)
                  values = startValues(
                    type,
                    drawn,
                    numberKeys,
                    blocks.filter((_, position) => position !== index),
                    formats,
                  );
                kept.values = values;
              }
              commit(blocks.map((item, position) => (position === index ? kept : item)));
            }}
            onMove={(step) => {
              const next = [...blocks];
              [next[index], next[index + step]] = [next[index + step], next[index]];
              commit(next);
            }}
            onRemove={() => commit(blocks.filter((_, position) => position !== index))}
          />
        ))}
        {!blocks.length && (
          <p className="studio-note">Only the header shows. Add status history, response time or recent logs.</p>
        )}
        <Row
          label="Add a block"
          info={valued ? "Any look, any values, as many as you like (up to 12)." : "Up to 12 blocks."}
        >
          <Select
            className="studio-add-block"
            label="Add a block"
            placeholder="+ Add a block"
            value=""
            disabled={blocks.length >= MAX_BLOCKS}
            options={offered.map((type) => [type, BLOCK_NAMES[type], BLOCK_DETAILS[type]])}
            onChange={(type) => {
              const values = startValues(type, drawn, numberKeys, blocks, formats);
              commit([...blocks, { id: newId(), type, ...(values ? { values } : {}) }]);
            }}
          />
        </Row>
        {blocks.length > 1 && (
          <Row label="Blocks sit">
            {ownKey("arrange") && <span className="studio-own-tag">this size</span>}
            <Segmented
              label="Blocks sit"
              value={arrange}
              onChange={(next) => onLook(write("arrange", next))}
              options={[
                ["auto", dirNow],
                ["row", "Side by side"],
                ["col", "Stacked"],
                ...(blocks.length > 2 ? [["grid", "Grid"]] : []),
              ]}
            />
          </Row>
        )}
      </Group>
    </div>
  );
}
