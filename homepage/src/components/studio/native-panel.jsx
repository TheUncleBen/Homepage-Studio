import { memo, useContext } from "react";

import CardDateTime from "./card-datetime";
import { CardLookContext } from "./card-look";
import Filler, { isFiller } from "./fillers";
import { resolveNativePanel } from "./native-adapter.mjs";
import { usePreferences, withDisplayPreferences } from "./preferences";
import { BookmarkCard, ServiceCard, WidgetCard } from "./studio-card";

import BookmarkItem from "components/bookmarks/item";
import ErrorBoundary from "components/errorboundry";
import ServiceItem from "components/services/item";
import ServiceWidget from "components/services/widget";
import InformationWidget from "components/widgets/widget";

// override: unsaved link fields (name, address, description, icon), or an
// integration widget's logo, description and fields, for the edit dialog's
// preview.
export default memo(function NativePanel({ panel, data, override }) {
  const resolved = withOverride(resolveNativePanel(panel, data), override);
  const card = useContext(CardLookContext);
  const preferences = usePreferences();
  if (!resolved)
    return (
      <div className="studio-panel-placeholder">
        <strong>Content unavailable</strong>
        <p>Its native configuration could not be matched. Open Edit to review the source.</p>
      </div>
    );
  // Studio's own cards: one header, the widget's values arranged by its look.
  if (card)
    return (
      <ErrorBoundary>
        {resolved.kind === "service" && <ServiceCard service={resolved.service} groupName={resolved.groupName} />}
        {resolved.kind === "serviceWidget" && (
          <WidgetCard service={resolved.service} widget={resolved.widget} groupName={resolved.groupName} />
        )}
        {resolved.kind === "informationWidget" &&
          (isFiller(resolved.widget.type) ? (
            <Filler widget={resolved.widget} />
          ) : resolved.widget.type === "resources" && !showsResources(resolved.widget.options) ? (
            <div className="studio-panel-placeholder">
              <strong>Nothing chosen to show</strong>
              <p>Edit it to pick CPU, memory, disk or more.</p>
            </div>
          ) : resolved.widget.type === "datetime" ? (
            <CardDateTime options={withDisplayPreferences(resolved.widget, preferences).options ?? {}} />
          ) : (
            <InformationWidget widget={withDisplayPreferences(resolved.widget, preferences)} style="clean" />
          ))}
        {resolved.kind === "bookmark" && <BookmarkCard bookmark={resolved.bookmark} />}
      </ErrorBoundary>
    );
  return (
    <ErrorBoundary>
      {resolved.kind === "service" && (
        <ul className="studio-native-list">
          <ServiceItem service={resolved.service} groupName={resolved.groupName} useEqualHeights />
        </ul>
      )}
      {resolved.kind === "serviceWidget" && <ServiceWidget widget={resolved.widget} service={resolved.service} />}
      {resolved.kind === "informationWidget" &&
        (isFiller(resolved.widget.type) ? (
          <Filler widget={resolved.widget} />
        ) : (
          <InformationWidget widget={withDisplayPreferences(resolved.widget, preferences)} style="clean" />
        ))}
      {resolved.kind === "bookmark" && (
        <ul className="studio-native-list">
          <BookmarkItem bookmark={resolved.bookmark} />
        </ul>
      )}
    </ErrorBoundary>
  );
});

// Resources draws nothing unless one of its readings is turned on.
function showsResources(options = {}) {
  return ["cpu", "memory", "disk", "network", "cputemp", "uptime"].some((key) =>
    Array.isArray(options[key]) ? options[key].length > 0 : Boolean(options[key]),
  );
}

function withOverride(resolved, override) {
  if (!resolved || !override) return resolved;
  // The draft is the whole link, so a field it leaves out is shown as gone.
  if (resolved.kind === "service") return { ...resolved, service: { ...resolved.service, ...override } };
  if (resolved.kind === "bookmark") return { ...resolved, bookmark: { ...resolved.bookmark, ...override } };
  // An integration widget: its unsaved logo and description, and the values
  // its fields list asks for, so the preview shows a value as soon as it is
  // shown (owner T8 on 65f724c), not only after saving.
  if (resolved.kind === "serviceWidget") {
    const { fields, ...service } = override;
    return {
      ...resolved,
      service: { ...resolved.service, ...service },
      widget: fields ? { ...resolved.widget, fields } : resolved.widget,
    };
  }
  // A Studio filler: its unsaved settings (text, size, picture).
  if (resolved.kind === "informationWidget" && override.options)
    return {
      ...resolved,
      widget: { ...resolved.widget, options: { ...override.options, index: resolved.widget.options?.index } },
    };
  return resolved;
}
