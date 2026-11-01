import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import CardBackground, { backgroundSource } from "./card-background";
import {
  CardLookContext,
  fillColours,
  resolvedBehaviour,
  resolvedLook,
  useCardTheme,
  useLogoColour,
  widgetFields,
} from "./card-look";
import Freshness from "./freshness";
import { COLUMNS, GAP, ROW_HEIGHT } from "./geometry.mjs";
import { touchesNativeContent, useLongPress, useStackGestures } from "./gestures";
import StudioIcon from "./icons";
import { REFRESH_MS } from "./look.mjs";
import { resolveNativePanel } from "./native-adapter.mjs";
import NativePanel from "./native-panel";

import { SettingsContext } from "utils/contexts/settings";

const iconOf = (resolved) => resolved?.service?.icon || resolved?.bookmark?.icon || null;

// How a card looks: built-in, then the dashboard's defaults, then its own.
// Shared by the board and the widget dialog's live preview.
export function useCardPresentation(panel, data, onEdit) {
  const settings = useContext(SettingsContext)?.settings;
  const look = useMemo(() => resolvedLook(settings, panel), [settings, panel]);
  const behaviour = useMemo(() => resolvedBehaviour(settings, panel), [settings, panel]);
  const resolved = useMemo(() => resolveNativePanel(panel, data), [panel, data]);
  const theme = useCardTheme();
  const wantsLogo = (look.fill === "tint" || look.fill === "solid") && look.colour === "logo";
  const logoColour = useLogoColour(iconOf(resolved), wantsLogo);
  const colours = useMemo(() => fillColours(look, logoColour, theme), [look, logoColour, theme]);
  const card = useMemo(
    () => ({
      id: panel.id,
      layout: look.layout,
      values: look.values,
      header: look.header,
      description: look.description,
      status: look.status,
      statusCheck: behaviour.status,
      errors: behaviour.errors,
      target: behaviour.target,
      refreshMs: REFRESH_MS[behaviour.refresh],
      onFix: onEdit ? () => onEdit(panel) : undefined,
      reportFields: (fields) => widgetFields.set(panel.id, fields),
    }),
    [panel, look, behaviour, onEdit],
  );
  const pictured =
    (look.fill === "picture" || look.fill === "pattern") && Boolean(backgroundSource(look.background, theme));
  const backdrop = pictured ? <CardBackground background={look.background} tokens={theme} /> : null;
  const attributes = {
    "data-layout": look.layout,
    "data-fill": colours || pictured ? look.fill : "plain",
    "data-edge": look.edge,
    "data-corners": look.corners,
    "data-numbers": look.numbers,
    "data-align": look.align,
    "data-hero": look.heroSize,
  };
  const colourStyle = colours
    ? { "--card-fill": colours.fill, "--card-ink": colours.ink, "--card-muted": colours.muted }
    : {};
  return { look, behaviour, colours, card, attributes, colourStyle, backdrop };
}

// A card on its own, outside the board: the widget dialog's live preview.
export function CardPreview({ panel, data, override, renderNative: RenderNative = NativePanel }) {
  const { card, attributes, colourStyle, backdrop } = useCardPresentation(panel, data, undefined);
  // Drawn at the widget's own size on a typical 1200 px wide board.
  const rect = panel.rect || { w: 6, h: 4 };
  const column = (1200 - (COLUMNS - 1) * GAP) / COLUMNS;
  const size = {
    width: `min(100%, ${Math.round(rect.w * column + (rect.w - 1) * GAP)}px)`,
    height: Math.min(rect.h * ROW_HEIGHT + (rect.h - 1) * GAP, 280),
  };
  return (
    <section
      className="studio-panel studio-card-preview"
      data-panel-kind={panel.kind}
      aria-label={`Preview of ${panel.title}`}
      style={{ ...colourStyle, ...size }}
      {...attributes}
    >
      <div className="studio-panel-slide">
        {backdrop}
        <div className="studio-native-content" inert>
          <CardLookContext.Provider value={{ ...card, reportFields: undefined }}>
            <RenderNative panel={panel} data={data} override={override} />
          </CardLookContext.Provider>
        </div>
      </div>
    </section>
  );
}

export default function PanelHost({
  panel,
  data,
  rect,
  stack,
  active = true,
  selected,
  editing,
  busy = false,
  overlayOpen = false,
  stale = false,
  saved = false,
  moving,
  reducedMotion,
  controller,
  dragOffset = 0,
  onStackDrag,
  onManual,
  onEdit,
  canEdit = true,
  onSelect,
  onManipulate,
  onUnitKey,
  onLongPress,
  renderNative: RenderNative = NativePanel,
}) {
  const nativeContent = useRef(null);
  const slide = useRef(null);
  const { card, attributes, colourStyle, backdrop } = useCardPresentation(panel, data, canEdit ? onEdit : undefined);
  const previousPresentation = useRef(null);
  const slideAnimation = useRef(null);
  const playback = controller?.();
  const press = useLongPress({
    disabled: busy || overlayOpen || Boolean(stack) || !onLongPress,
    accepts: (event) => !event.target.closest("button,input"),
    onLongPress: (pointer) => onLongPress?.(panel.id, pointer),
  });
  useEffect(() => {
    if (!playback || !active) return undefined;
    const reason = `embedded-focus:${panel.id}`;
    let listening = true;
    const update = () => {
      if (!listening) return;
      const focused = document.activeElement;
      playback.setBlocked(reason, focused?.tagName === "IFRAME" && nativeContent.current?.contains(focused));
    };
    // Focus events inside another document do not bubble through the iframe.
    // Its parent element is still observable without reading cross-origin data.
    const afterFocus = () => queueMicrotask(update);
    window.addEventListener("blur", afterFocus);
    window.addEventListener("focus", afterFocus);
    document.addEventListener("focusin", afterFocus);
    update();
    return () => {
      listening = false;
      window.removeEventListener("blur", afterFocus);
      window.removeEventListener("focus", afterFocus);
      document.removeEventListener("focusin", afterFocus);
      playback.setBlocked(reason, false);
    };
  }, [playback, active, panel.id]);
  const gestures = useStackGestures({
    controller,
    disabled: editing || busy || overlayOpen || !stack,
    onDrag: onStackDrag,
    onManual,
  });
  // Touch hold on the panel body selects like the header does (IN-01), unless
  // the touch starts on interactive or horizontally scrolling native content.
  // Mouse keeps header-only holds; the header handles its own presses.
  const bodyHeld = useRef(0);
  const bodyPress = useLongPress({
    disabled: busy || overlayOpen || !onLongPress,
    accepts: (event) =>
      event.pointerType === "touch" &&
      !event.target.closest(".studio-panel-header,.studio-resize-handle") &&
      !touchesNativeContent(event),
    onLongPress: (pointer) => {
      bodyHeld.current = Date.now();
      onLongPress?.(stack ? stack.id : panel.id, pointer);
    },
  });
  useLayoutEffect(() => {
    // touch-action is fixed when a touch starts. Body content that overflows
    // horizontally keeps native panning; otherwise the body allows only
    // vertical panning so horizontal swipes and holds reach the panel.
    // Only a body that really scrolls vertically contains its overscroll;
    // otherwise a vertical swipe on the body must scroll the page.
    const element = nativeContent.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      if (element.scrollWidth > element.clientWidth + 1) element.dataset.studioScrollX = "";
      else delete element.dataset.studioScrollX;
      if (element.scrollHeight > element.clientHeight + 1) element.dataset.studioScrollY = "";
      else delete element.dataset.studioScrollY;
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    [...element.children].forEach((child) => observer.observe(child));
    // Native content can replace its children after mount; observe those too.
    const children =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            [...element.children].forEach((child) => observer.observe(child));
            update();
          });
    children?.observe(element, { childList: true });
    update();
    return () => {
      observer.disconnect();
      children?.disconnect();
    };
  }, []);
  const duration =
    reducedMotion || stack?.playback.transition === "none" ? 0 : (stack?.playback.transitionDurationMs ?? 250);
  const style = {
    ...rect,
    "--studio-slide-duration": `${duration}ms`,
    ...colourStyle,
  };
  const memberIndex = stack?.panelIds.indexOf(panel.id) ?? 0;
  const snapshot = playback?.getSnapshot();
  const activeIndex = snapshot?.activeIndex ?? 0;
  const direction =
    snapshot?.previousId === panel.id && snapshot.direction ? -snapshot.direction : memberIndex < activeIndex ? -1 : 1;
  const translation =
    stack?.playback.transition === "vertical" ? `translateY(${direction * 100}%)` : `translateX(${direction * 100}%)`;
  let translate = !active && stack && !["none", "fade"].includes(stack.playback.transition) ? translation : "none";
  const nextIndex = stack ? (activeIndex + 1) % stack.panelIds.length : 0;
  const previousIndex = stack ? (activeIndex - 1 + stack.panelIds.length) % stack.panelIds.length : 0;
  const neighbor =
    stack &&
    dragOffset &&
    ((dragOffset < 0 && memberIndex === nextIndex && (snapshot?.loop || activeIndex < stack.panelIds.length - 1)) ||
      (dragOffset > 0 && memberIndex === previousIndex && (snapshot?.loop || activeIndex > 0)));
  const presented = active || Boolean(neighbor);
  if (stack && dragOffset)
    translate = `translateX(${dragOffset + (active ? 0 : dragOffset < 0 ? rect.width : -rect.width)}px)`;
  useLayoutEffect(() => {
    const previous = previousPresentation.current;
    const interrupted =
      slideAnimation.current?.playState === "running" ? getComputedStyle(slide.current).transform : null;
    if (previous?.active !== active || previous?.stackId !== stack?.id || dragOffset || !duration) {
      slideAnimation.current?.cancel();
      slideAnimation.current = null;
    }
    if (
      previous &&
      active !== previous.active &&
      previous?.stackId === stack?.id &&
      snapshot?.direction &&
      duration &&
      ["horizontal", "vertical"].includes(stack?.playback.transition)
    ) {
      const from =
        interrupted ||
        (previous.dragOffset
          ? `translateX(${previous.dragOffset + (active ? (previous.dragOffset < 0 ? rect.width : -rect.width) : 0)}px)`
          : active
            ? `${stack.playback.transition === "vertical" ? "translateY" : "translateX"}(${snapshot.direction * 100}%)`
            : "none");
      // Explicit direction is necessary at a loop boundary, where numeric member
      // order would place the entering slide on the opposite side. Animate this
      // existing host, starting at its finger-following offset after a swipe.
      slideAnimation.current = slide.current?.animate?.(
        [{ transform: from }, { transform: active ? "none" : translation }],
        {
          duration,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        },
      );
    }
    previousPresentation.current = { active, dragOffset, stackId: stack?.id };
  }, [
    active,
    dragOffset,
    duration,
    rect.width,
    snapshot?.direction,
    stack?.id,
    stack?.playback.transition,
    translation,
  ]);
  useEffect(() => () => slideAnimation.current?.cancel(), []);
  return (
    <section
      className={`studio-panel${stack ? " studio-stacked-panel" : ""}${selected ? " studio-selected" : ""}${moving ? " studio-moving" : ""}${!presented ? " studio-inactive" : ""}${!active ? " studio-noninteractive" : ""}`}
      data-panel-id={panel.id}
      data-panel-kind={panel.kind}
      {...attributes}
      data-stack-id={stack?.id}
      aria-label={panel.title}
      aria-hidden={!active || undefined}
      inert={!active}
      style={style}
      {...gestures}
      onPointerDown={(event) => {
        gestures.onPointerDown(event);
        bodyPress.onPointerDown(event);
      }}
      onPointerMove={(event) => {
        gestures.onPointerMove(event);
        bodyPress.onPointerMove(event);
      }}
      onPointerUp={(event) => {
        bodyPress.onPointerUp(event);
        gestures.onPointerUp(event);
      }}
      onPointerCancel={(event) => {
        bodyPress.onPointerCancel(event);
        gestures.onPointerCancel(event);
      }}
      onContextMenu={(event) => {
        // A recognized touch hold must not also open the native context menu.
        if (Date.now() - bodyHeld.current < 1500) return event.preventDefault();
        // While editing, a right-click anywhere on the widget opens its menu.
        if (event.defaultPrevented || busy || !onLongPress || event.target.closest("input,textarea,select")) return;
        event.preventDefault();
        onLongPress(stack ? stack.id : panel.id, { clientX: event.clientX, clientY: event.clientY });
      }}
    >
      <div
        ref={slide}
        className="studio-panel-slide"
        style={{
          opacity: presented ? 1 : 0,
          transform: translate,
          transition: dragOffset ? "none" : undefined,
        }}
      >
        {backdrop}
        {/* The card draws its own logo and name. While editing, a small bar
            on top holds selection, move and edit. */}
        {!stack && editing && (
          <header
            className="studio-panel-header"
            onPointerDown={press.onPointerDown}
            onPointerMove={press.onPointerMove}
            onPointerUp={press.onPointerUp}
            onPointerCancel={press.onPointerCancel}
            onContextMenu={(event) => {
              press.cancel();
              if (busy || !onLongPress) return;
              event.preventDefault();
              onLongPress?.(panel.id, { clientX: event.clientX, clientY: event.clientY });
            }}
          >
            {editing && (
              // The label enlarges the touch target around the native checkbox.
              <label className="studio-select-target">
                <input
                  type="checkbox"
                  aria-label={`Select ${panel.title}`}
                  checked={Boolean(selected)}
                  disabled={busy}
                  onChange={() => onSelect(panel.id)}
                />
              </label>
            )}
            <span className="studio-panel-title studio-sr-only">
              <small>{panel.group || (panel.kind === "informationWidget" ? "Information" : "Dashboard")}</small>
              <strong>{panel.title}</strong>
            </span>
            {editing && (
              <>
                <button
                  className="studio-icon-button studio-move-handle"
                  disabled={busy}
                  aria-label={`Move ${panel.title}. Use arrow keys; Shift and arrow keys resize.`}
                  title="Drag to move · arrows to move · Shift + arrows to resize"
                  onPointerDown={(event) => onManipulate(event, panel.id, "move")}
                  onKeyDown={(event) => onUnitKey(event, panel.id)}
                >
                  <StudioIcon name="grip" />
                </button>
                {canEdit && (
                  <button
                    className="studio-icon-button"
                    disabled={busy}
                    aria-label={`Edit ${panel.title}`}
                    onClick={() => onEdit(panel)}
                  >
                    <StudioIcon name="edit" />
                  </button>
                )}
              </>
            )}
          </header>
        )}
        <div
          ref={nativeContent}
          className="studio-native-content"
          inert={stale}
          aria-hidden={stale || undefined}
          style={{ visibility: stale ? "hidden" : undefined }}
          onFocusCapture={() => controller?.()?.setBlocked("content-focus", true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) controller?.()?.setBlocked("content-focus", false);
          }}
        >
          <CardLookContext.Provider value={card}>
            <RenderNative panel={panel} data={data} />
          </CardLookContext.Provider>
        </div>
        {!editing && !stale && <Freshness panelId={panel.id} title={panel.title} />}
        {stale && (
          <div
            className="studio-panel-placeholder studio-panel-refresh"
            style={{
              position: "absolute",
              inset: stack ? "59px 15px 32px" : "56px 15px 16px",
              minHeight: 0,
            }}
          >
            <strong>{saved ? "Changes saved" : "Updating content"}</strong>
            <p>Waiting for refreshed widget data.</p>
          </div>
        )}
        {editing && !stack && (
          <button
            className="studio-resize-handle"
            disabled={busy}
            aria-label={`Resize ${panel.title}. Use arrow keys.`}
            title="Drag to resize · arrow keys"
            onPointerDown={(event) => onManipulate(event, panel.id, "resize")}
            onKeyDown={(event) => onUnitKey(event, panel.id, "resize")}
          >
            <StudioIcon name="resize" size={16} />
          </button>
        )}
      </div>
    </section>
  );
}
