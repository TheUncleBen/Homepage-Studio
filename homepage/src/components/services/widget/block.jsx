import classNames from "classnames";
import { useTranslation } from "next-i18next/pages";
import { useContext, useMemo } from "react";

import { BlockHighlightContext } from "./highlight-context";

import { ValueSlotContext } from "components/studio/card-look";
import { formatValue, splitValue } from "components/studio/value-format.mjs";
import { SettingsContext } from "utils/contexts/settings";
import { evaluateHighlight, getHighlightClass } from "utils/highlights";

export default function Block({ value, highlightValue, label, field }) {
  const { t } = useTranslation();
  const highlightConfig = useContext(BlockHighlightContext);
  const { settings } = useContext(SettingsContext);
  const refined = settings?.blockStyle === "refined";
  const slot = useContext(ValueSlotContext);

  const highlight = useMemo(() => {
    if (!highlightConfig) return null;
    const labels = Array.isArray(label) ? label : [label];
    const candidates = [];
    if (typeof field === "string") candidates.push(field);
    for (const candidateLabel of labels) {
      if (typeof candidateLabel === "string") candidates.push(candidateLabel);
    }

    for (const candidate of candidates) {
      const result = evaluateHighlight(candidate, highlightValue ?? value, highlightConfig);
      if (result) return result;
    }

    return null;
  }, [field, label, value, highlightValue, highlightConfig]);

  const highlightClass = useMemo(() => {
    if (!highlight?.level) return undefined;
    return getHighlightClass(highlight.level, highlightConfig);
  }, [highlight, highlightConfig]);

  const applyToValueOnly = highlight?.valueOnly === true;

  // Inside a Studio card: the slot decides the size; the label and number
  // style can be the widget's own.
  if (slot) {
    const loading = value === undefined;
    const shown = loading || value === null ? "-" : formatValue(value, slot.format);
    const { number, unit } = slot.slot === "hero" ? splitValue(shown) : { number: shown, unit: "" };
    const text = slot.label || t(label);
    return (
      <div
        className={classNames("studio-value", `studio-value-${slot.slot}`, loading && "studio-value-loading", highlightClass, "service-block")}
        data-highlight-level={highlight?.level}
        data-highlight-source={highlight?.source}
      >
        <span className={classNames("studio-value-number", applyToValueOnly && "studio-value-highlighted", "service-block-value")}>
          {number}
          {unit && <span className="studio-value-unit">{unit}</span>}
        </span>
        <span className="studio-value-label service-block-label">{text}</span>
      </div>
    );
  }

  return (
    <div
      className={classNames(
        "bg-theme-200/50 dark:bg-theme-900/20 rounded-sm m-1 flex-1 flex flex-col items-center justify-center text-center p-1",
        value === undefined ? "animate-pulse" : "",
        highlightClass,
        "service-block",
      )}
      data-highlight-level={highlight?.level}
      data-highlight-source={highlight?.source}
    >
      <div
        className={classNames(
          refined ? "text-[13px] font-medium tabular-nums" : "font-thin text-sm",
          "service-block-value",
        )}
      >
        {value === undefined || value === null ? "-" : value}
      </div>
      <div
        className={classNames(
          refined ? "text-[10px] font-semibold uppercase tracking-wider opacity-60" : "font-bold text-xs uppercase",
          applyToValueOnly && "text-theme-700 dark:text-theme-200",
          "service-block-label",
        )}
      >
        {t(label)}
      </div>
    </div>
  );
}
