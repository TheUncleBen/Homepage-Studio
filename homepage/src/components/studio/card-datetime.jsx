import { useTranslation } from "next-i18next/pages";
import { useMemo } from "react";

import useCurrentTime from "utils/hooks/use-current-time";

// The native Date & Time widget writes one line. In a Studio card, a format
// that has both a time and a date shows the time large with the date under
// it (owner-approved boards 1 and 4). The widget's own options still decide
// what is written; only the layout changes.
const TIME_KEYS = ["timeStyle", "hour", "minute", "second", "fractionalSecondDigits", "dayPeriod", "timeZoneName"];
const DATE_KEYS = ["dateStyle", "weekday", "era", "year", "month", "day"];
const SIZES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];

export function splitFormat(format = {}) {
  const has = (keys) => keys.some((key) => format[key] !== undefined);
  if (!has(TIME_KEYS) || !has(DATE_KEYS)) return null;
  const only = (keep, drop) =>
    Object.fromEntries(Object.entries(format).filter(([key]) => keep.includes(key) || !drop.includes(key)));
  return { time: only(TIME_KEYS, DATE_KEYS), date: only(DATE_KEYS, TIME_KEYS) };
}

export default function CardDateTime({ options }) {
  const { text_size: textSize, locale, format } = options;
  const { i18n } = useTranslation();
  const language = locale ?? i18n.language;
  const now = useCurrentTime(1000);
  const formatters = useMemo(() => {
    const parts = splitFormat(format);
    const make = (value) => new Intl.DateTimeFormat(language, { ...value });
    return parts ? { hero: make(parts.time), below: make(parts.date) } : { hero: make(format) };
  }, [language, format]);
  if (now === null) return null;
  const date = new Date(now);
  const size = SIZES.includes(textSize) ? textSize : "lg";
  return (
    <div className="studio-datetime">
      <span className={`studio-datetime-hero studio-datetime-${size}`}>{formatters.hero.format(date)}</span>
      {formatters.below && <span className="studio-datetime-below">{formatters.below.format(date)}</span>}
    </div>
  );
}
