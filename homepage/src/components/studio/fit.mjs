// Fitting a card's blocks to its size (widget redesign, mock-ups v4, approved
// 9 Nov 2026). Everything a card shows is always drawn in full: nothing folds
// behind "+N". At any size the card uses the owner's choices exactly; for
// anything left on Auto it takes the first way of drawing that suits the
// card's shape at full-size text, else the one that allows the largest text.
// Text scales with the card (--s) down to the owner's smallest text size.
//
// A way of drawing (a "pick") is only data attributes and CSS variables, so
// trying one is a style change and a measurement, never a React render.

export const TEXT_FLOOR = Object.freeze({ small: 0.8, medium: 0.9, large: 1 });
export const FIXED_TEXT = Object.freeze({ small: 0.85, medium: 1, large: 1.2 });
export const MAX_SCALE = 1.6;
const LAST_RESORT = 0.4;
const MAX_COMBOS = 48;

export const floorOf = (look) => (look.text === "fixed" ? FIXED_TEXT : TEXT_FLOOR)[look.textSize] ?? 0.9;
export const ceilingOf = (look) => (look.text === "fixed" ? floorOf(look) : MAX_SCALE);

// Does everything show in full? Overflow anywhere (the card, a block, a
// value, a label) means no. Log lines may be cut at the bottom, but at least
// two must show.
export function fits(card) {
  const over = (node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;
  if (over(card)) return false;
  const body = card.querySelector(".studio-blocks");
  if (body && over(body)) return false;
  for (const block of card.querySelectorAll(".studio-block")) {
    if (block.dataset.clip !== undefined) {
      const line = block.querySelector(".studio-log-line");
      if (block.scrollWidth > block.clientWidth + 1) return false;
      if (line && block.clientHeight < line.offsetHeight * 2) return false;
    } else if (block.querySelector(".studio-chart-note")) {
      // A passing note ("Collecting numbers…") never sets how small a card
      // can be; it is cut to the block instead.
      if (block.scrollWidth > block.clientWidth + 1) return false;
    } else if (over(block)) return false;
  }
  // A number or a name cut short, a value squeezed to nothing.
  for (const node of card.querySelectorAll(
    ".studio-card-head, .studio-card-name strong, .studio-value, .studio-value-number, .studio-value-label, .studio-block-legend, .studio-chart-legend li, .studio-bar-label, .studio-bar-value, .studio-block-caption",
  ))
    if (node.scrollWidth > node.clientWidth + 1) return false;
  // A chart squeezed too small to read.
  for (const node of card.querySelectorAll(".studio-chart-round, svg.studio-chart-gauge"))
    if (node.getBoundingClientRect().height < 36) return false;
  for (const node of card.querySelectorAll(".studio-chart-svg"))
    if (node.getBoundingClientRect().height < 28) return false;
  return true;
}

// Auto's order of arrangements for a Numbers block, by the card's shape.
export function shapeOrder(width, height) {
  const ratio = width / height;
  if (height < 110) return ["row", "list", "grid"];
  if (ratio < 0.8) return ["list", "grid", "row"];
  if (ratio > 2.3) return ["row", "grid", "list"];
  return ["grid", "list", "row"];
}
// Column counts worth trying for n boxes: each number of rows once.
export function columnOptions(count, chosen = "auto") {
  if (count <= 1) return [1];
  if (chosen !== "auto") return [Math.min(Number(chosen), count)];
  const out = new Set();
  for (let rows = 1; rows <= count; rows += 1) out.add(Math.ceil(count / rows));
  return [...out];
}

// The ways one block can be drawn: only what is left on Auto varies.
export function blockVariants(block, count, width, height) {
  if (block.type === "numbers") {
    const out = [];
    const arranges = (block.arrange || "auto") === "auto" ? shapeOrder(width, height) : [block.arrange];
    for (const arrange of arranges)
      for (const columns of arrange === "row" ? [0] : columnOptions(count, block.columns || "auto"))
        out.push({ arrange, columns });
    return out;
  }
  if (block.type === "pie") {
    const legend = block.legend || "auto";
    if (legend !== "auto") return [{ legend }];
    return width / height > 1.3 ? [{ legend: "beside" }, { legend: "below" }] : [{ legend: "below" }, { legend: "beside" }];
  }
  return [{}];
}

// Every way of drawing at width x height, in the order Auto prefers.
// counts: how many values each block shows (by block id).
export function candidates(look, blocks, counts, width, height) {
  const many = blocks.length;
  const ratio = width / height;
  const arrange = look.arrange || "auto";
  const dirs =
    many < 2
      ? ["col"]
      : arrange !== "auto"
        ? [arrange === "grid" && many < 3 ? "row" : arrange]
        : many >= 3
          ? ratio > 1.4
            ? ["row", "grid", "col"]
            : ratio < 0.8
              ? ["col", "grid", "row"]
              : ["grid", "col", "row"]
          : ratio > 1.4
            ? ["row", "col"]
            : ["col", "row"];
  const headerAt = look.headerAt || "auto";
  const inlines =
    look.header === "hidden" ? [false] : headerAt === "left" ? [true] : headerAt === "top" ? [false] : ratio > 2.4 ? [false, true] : [false];
  let combos = [[]];
  for (const block of blocks) {
    const variants = blockVariants(block, counts[block.id] ?? 0, width, height);
    const next = [];
    for (const combo of combos)
      for (const variant of variants) {
        if (next.length >= MAX_COMBOS) break;
        next.push([...combo, variant]);
      }
    combos = next;
  }
  const out = [];
  for (const variants of combos) for (const dir of dirs) for (const inline of inlines) out.push({ variants, dir, inline });
  return out;
}

export const isAuto = (look, blocks) =>
  blocks.some(
    (block) =>
      (block.type === "numbers" && ((block.arrange || "auto") === "auto" || (block.columns || "auto") === "auto")) ||
      (block.type === "pie" && (block.legend || "auto") === "auto"),
  ) ||
  (blocks.length > 1 && (look.arrange || "auto") === "auto") ||
  (look.header !== "hidden" && (look.headerAt || "auto") === "auto");

// Auto in place of every choice that has an Auto, for the last resort.
export const relaxed = (look, blocks) => ({
  look: { ...look, arrange: "auto", headerAt: "auto" },
  blocks: blocks.map((block) =>
    block.type === "numbers"
      ? { ...block, arrange: "auto", columns: "auto" }
      : block.type === "pie"
        ? { ...block, legend: "auto" }
        : block,
  ),
});

// Put a pick on the card's elements.
export function apply(card, blocks, pick, scale) {
  card.style.setProperty("--s", String(scale));
  if (!pick) return;
  if (pick.inline) card.setAttribute("data-inline", "");
  else card.removeAttribute("data-inline");
  const body = card.querySelector(".studio-blocks");
  if (body) body.dataset.dir = pick.dir;
  blocks.forEach((block, index) => {
    const node = card.querySelector(`.studio-block[data-block="${CSS.escape(block.id)}"]`);
    const variant = pick.variants[index] || {};
    if (!node) return;
    if (variant.arrange) node.dataset.arrange = variant.arrange;
    if (variant.columns !== undefined) node.style.setProperty("--columns", String(variant.columns || 1));
    if (variant.legend) node.dataset.legend = variant.legend;
  });
}

// The best pick at the card's current size, with text between floor and cap.
export function layout(card, look, blocks, counts, width, height, floor = floorOf(look), cap = ceilingOf(look)) {
  const low = floor;
  const high = Math.max(low, cap);
  const all = candidates(look, blocks, counts, width, height);
  const at = (pick, scale) => {
    apply(card, blocks, pick, scale);
    return fits(card);
  };
  const grow = (pick, from) => {
    let lo = from;
    let hi = high;
    if (hi <= lo) return lo;
    if (at(pick, hi)) return hi;
    for (let i = 0; i < 6; i += 1) {
      const mid = (lo + hi) / 2;
      if (at(pick, mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  if (isAuto(look, blocks) && all.length > 1) {
    const threshold = Math.max(low, Math.min(1, high));
    for (const pick of all) if (at(pick, threshold)) return { ...pick, scale: grow(pick, threshold) };
  }
  let best = null;
  for (const pick of all) {
    const start = best ? Math.min(high, best.scale + 0.02) : low;
    if (best && start <= best.scale) continue;
    if (at(pick, start)) best = { ...pick, scale: grow(pick, start) };
  }
  return best;
}

// Fit the card: your choices at your smallest text or larger; else smaller
// text (squeezed); else, as a last resort, Auto for every choice (relaxed),
// so nothing is ever cut off. Leaves the pick applied.
export function fitCard(card, look, blocks, counts) {
  const width = card.clientWidth;
  const height = card.clientHeight;
  if (!width || !height) return null;
  const floor = floorOf(look);
  let best = layout(card, look, blocks, counts, width, height);
  let squeezed = false;
  let relax = false;
  let used = { look, blocks };
  for (let f = floor - 0.05; !best && f >= LAST_RESORT; f -= 0.05) {
    best = layout(card, look, blocks, counts, width, height, f, floor - 0.01);
    if (best) squeezed = true;
  }
  if (!best) {
    const r = relaxed(look, blocks);
    for (let f = floor; !best && f >= LAST_RESORT; f -= 0.05) {
      best = layout(card, r.look, r.blocks, counts, width, height, f, floor);
      if (best) {
        relax = true;
        squeezed = f < floor;
        used = r;
      }
    }
  }
  if (!best) {
    const first = candidates(used.look, used.blocks, counts, width, height)[0];
    apply(card, used.blocks, first, LAST_RESORT);
    return { pick: first, scale: LAST_RESORT, squeezed: true, relaxed: true, fits: false, width, height };
  }
  // A hair under the largest that fits, so a pixel of rounding never clips.
  const scale = Math.max(LAST_RESORT, best.scale - (best.scale > floor ? 0.02 : 0));
  apply(card, used.blocks, best, scale);
  return { pick: best, scale, squeezed, relaxed: relax, fits: true, width, height };
}
