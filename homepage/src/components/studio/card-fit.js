import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { publishFit } from "./card-look";
import { fitCard } from "./fit.mjs";
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
    const result = fitCard(node, effective, shown, counts);
    if (result)
      publishFit(card.fitId || card.id, {
        ...result,
        sizeClass: classOf(box.w, box.h),
        box,
        blocks: shown,
        look: effective,
      });
  }, [box, signature, drawn, tick]);
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
