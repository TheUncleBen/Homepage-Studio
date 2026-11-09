import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { publishFit } from "./card-look";
import { apply, candidates, ceilingOf, fitCard, floorOf, LAST_RESORT, layout, relaxed, standsUp } from "./fit.mjs";
import { blocksOf, classOf, lookAt } from "./look.mjs";

const NONE = Object.freeze({});
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// The size of a card's widget box, kept up to date as it is resized.
function useBox(ref) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useIsoLayoutEffect(() => {
    const node = ref.current?.closest(".studio-panel, .studio-card-preview") || ref.current?.parentElement;
    if (!node) return undefined;
    const read = () => {
      const w = Math.round(node.offsetWidth);
      const h = Math.round(node.offsetHeight);
      setBox((old) => (old.w === w && old.h === h ? old : { w, h }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return box;
}

// The height (px, of the widget box) the card needs to show its settings at
// the usual text size, or 0 when the height it was given is enough. Tries
// heights on the widget box itself and puts its own height back after.
const MAX_GROWTH = 6;
function neededHeight(node, base, look, blocks, counts) {
  const panel = node.closest(".studio-panel, .studio-card-preview");
  if (!panel || !blocks.length) return 0;
  const kept = panel.style.height;
  const width = node.clientWidth;
  const extra = panel.offsetHeight - node.clientHeight;
  const floor = floorOf(look);
  const cap = ceilingOf(look);
  // Fits at this height with text no smaller than `smallest`?
  const fitsAt = (height, way, smallest) => {
    panel.style.height = `${height}px`;
    return Boolean(
      layout(node, way.look, way.blocks, counts, width, height - extra, smallest, Math.max(smallest, cap)),
    );
  };
  const yours = { look, blocks };
  let need = 0;
  if (!fitsAt(base, yours, floor)) {
    const high = Math.round(base * MAX_GROWTH);
    // Taller at your smallest text; where the width alone is too little for
    // that (a narrow window), taller with smaller text, then with Auto for
    // every choice, as fitCard does, so nothing is ever cut off.
    let found = null;
    for (const way of [yours, relaxed(look, blocks)]) {
      for (let smallest = floor; !found && smallest >= LAST_RESORT - 0.001; smallest -= 0.05)
        if (fitsAt(high, way, smallest)) found = { way, smallest };
      if (found) break;
    }
    // Too narrow for anything to fit fully, even with the smallest text: at
    // least as tall as Auto at the smallest text needs, so nothing is cut off
    // at the bottom.
    const test = found
      ? (height) => fitsAt(height, found.way, found.smallest)
      : (height) => {
          const way = relaxed(look, blocks);
          panel.style.height = `${height}px`;
          const pick = candidates(way.look, way.blocks, counts, width, height - extra)[0];
          apply(node, way.blocks, pick, LAST_RESORT);
          return standsUp(node);
        };
    if (found || test(high)) {
      let low = base;
      let top = high;
      for (let i = 0; i < 9 && top - low > 4; i += 1) {
        const mid = Math.round((low + top) / 2);
        if (test(mid)) top = mid;
        else low = mid;
      }
      need = top;
    } else need = high;
  }
  panel.style.height = kept;
  return need;
}

// Fits a card's blocks to its size (fit.mjs): the look in force at that size
// (its own layout for Small, Wide, Tall, Regular or Large, else All sizes),
// then the pick and text scale. It fits again when the size, the settings,
// the blocks drawn or the text inside change.
export function useBlockFit(card) {
  const ref = useRef(null);
  const box = useBox(ref);
  const look = card.look;
  const effective = useMemo(
    () => (box.w && box.h ? lookAt(look || NONE, box.w, box.h) : look || NONE),
    [look, box.w, box.h],
  );
  const blocks = blocksOf(effective);
  const [drawn, setDrawn] = useState(null);
  const [tick, setTick] = useState(0);
  const report = useCallback(
    (list) => setDrawn((old) => (JSON.stringify(old) === JSON.stringify(list) ? old : list)),
    [],
  );
  const context = useMemo(() => ({ blocks, report }), [blocks, report]);
  const signature = JSON.stringify([
    effective.blocks,
    effective.arrange,
    effective.headerAt,
    effective.header,
    effective.text,
    effective.textSize,
  ]);
  useIsoLayoutEffect(() => {
    const node = ref.current;
    if (!node || !box.w) return;
    const counts = Object.fromEntries(drawn || []);
    const shown = drawn ? blocks.filter((block) => Object.hasOwn(counts, block.id)) : [];
    // Where the board lets a card grow (a phone or tablet layout made from
    // the desktop one, or the live dashboard), it says how tall its settings
    // need it to be at its laid-out height's width (Board 6): measured at the
    // height it was given, never at the height it has grown to.
    const need = card.baseHeight ? neededHeight(node, card.baseHeight, effective, shown, counts) : 0;
    const result = fitCard(node, effective, shown, counts);
    if (result)
      publishFit(card.fitId || card.id, {
        ...result,
        sizeClass: classOf(box.w, box.h),
        box,
        blocks: shown,
        look: effective,
        need,
      });
  }, [box, signature, drawn, tick, card.baseHeight]);
  // New text (a value arriving, a longer number) can need another pick.
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof MutationObserver === "undefined") return undefined;
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setTick((n) => n + 1);
      });
    });
    observer.observe(node, { childList: true, characterData: true, subtree: true });
    // Text measures differently once the web font has loaded.
    let live = true;
    document.fonts?.ready?.then(() => live && setTick((n) => n + 1));
    return () => {
      live = false;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return { ref, effective, context };
}
