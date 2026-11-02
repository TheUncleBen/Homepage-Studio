import i18next from "i18next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { SWRConfig } from "swr";

import { SettingsContext } from "utils/contexts/settings";
import { CollectContext } from "utils/studio/collect-context";

// Chart history (owner choice, 1 Nov 2026: an always-on collector for the
// widgets shown as charts). The values a widget shows are worked out inside
// its React component, so the collector renders the component on the server:
// a first pass records which requests it makes, the requests run through the
// normal proxy, and later passes render with those answers until the widget
// asks for nothing new. Each value's number comes from the formatter call
// that would have written it ("common.number", "common.bytes", …), so units
// and locales never have to be read back from text.

const START = "\u0002";
const END = "\u0003";
const MAX_PASSES = 4;

// A translator that writes each formatted number as a marker carrying the
// raw value and its format, and everything else as its key.
function markerTranslator(key, options) {
  const name = Array.isArray(key) ? key[0] : key;
  if (typeof name === "string" && name.startsWith("common.") && options && options.value !== undefined) {
    const value = Number(options.value);
    if (Number.isFinite(value)) {
      const extra = {};
      for (const option of ["binary", "scale_units", "units", "unit"])
        if (options[option] !== undefined) extra[option] = options[option];
      return `${START}${JSON.stringify({ format: name.slice(7), value, ...extra })}${END}`;
    }
  }
  return typeof name === "string" ? name : "";
}

let translator;
function collectI18n() {
  if (translator) return translator;
  const instance = i18next.createInstance();
  instance.init({ lng: "en", resources: {}, initImmediate: false, react: { useSuspense: false } });
  const fixed = Object.assign(markerTranslator, { lng: "en", ns: "common" });
  instance.getFixedT = () => fixed;
  instance.t = markerTranslator;
  translator = instance;
  return instance;
}

// The first formatted number in a value, or null when it has none.
export function readMarker(value) {
  if (typeof value === "number" && Number.isFinite(value)) return { format: "plain", value };
  if (typeof value !== "string") return null;
  const start = value.indexOf(START);
  const end = start >= 0 ? value.indexOf(END, start) : -1;
  if (end < 0) return null;
  try {
    const marker = JSON.parse(value.slice(start + 1, end));
    return Number.isFinite(marker?.value) ? marker : null;
  } catch {
    return null;
  }
}

const keyOf = (props, index) => {
  const label = Array.isArray(props.label) ? props.label[0] : props.label;
  return typeof props.field === "string" ? props.field : typeof label === "string" ? label : `#${index}`;
};

// Renders a widget component for its values. load(key) answers one of the
// widget's own requests (its SWR key) with the response data, or throws.
// Returns { values: [{ field, label, value, format, … }] } or { error }.
export async function collectWidget(Component, service, load) {
  const answers = {};
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const wanted = new Set();
    let reported = null;
    const record = (useSWRNext) => (key, fetcher, config) => {
      if (typeof key === "string" && !Object.hasOwn(answers, key)) wanted.add(key);
      return useSWRNext(key, fetcher, config);
    };
    const tree = createElement(
      I18nextProvider,
      { i18n: collectI18n() },
      createElement(
        SettingsContext.Provider,
        { value: { settings: {} } },
        createElement(
          SWRConfig,
          {
            value: {
              provider: () => new Map(),
              fallback: answers,
              use: [record],
              fetcher: () => new Promise(() => {}),
              revalidateOnMount: false,
            },
          },
          createElement(
            CollectContext.Provider,
            {
              value: (error, children) => {
                reported = { error, children };
              },
            },
            createElement(Component, { service }),
          ),
        ),
      ),
    );
    try {
      renderToStaticMarkup(tree);
    } catch {
      return { error: "render" };
    }
    if (!wanted.size) {
      if (!reported) return { error: "no-values" };
      if (reported.error) return { error: "service" };
      const values = (reported.children || [])
        .filter((child) => child && typeof child === "object" && child.props)
        .map((child, index) => {
          const marker = readMarker(child.props.value);
          if (!marker) return null;
          const label = Array.isArray(child.props.label) ? child.props.label[0] : child.props.label;
          return { field: keyOf(child.props, index), label: typeof label === "string" ? label : "", ...marker };
        })
        .filter(Boolean);
      return { values };
    }
    // A request that fails answers with an error, as the proxy would, so
    // the widget reports its error instead of waiting.
    for (const key of wanted) {
      try {
        answers[key] = await load(key);
      } catch {
        answers[key] = { error: { message: "Request failed" } };
      }
    }
  }
  return { error: "too-many-requests" };
}
