import { memo, useContext } from "react";

import { CardLookContext } from "./card-look";
import { resolveNativePanel } from "./native-adapter.mjs";
import { BookmarkCard, ServiceCard, WidgetCard } from "./studio-card";

import BookmarkItem from "components/bookmarks/item";
import ErrorBoundary from "components/errorboundry";
import ServiceItem from "components/services/item";
import ServiceWidget from "components/services/widget";
import InformationWidget from "components/widgets/widget";

// override: unsaved link fields (name, address, description, icon) for the
// edit dialog's preview.
export default memo(function NativePanel({ panel, data, override }) {
  const resolved = withOverride(resolveNativePanel(panel, data), override);
  const card = useContext(CardLookContext);
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
        {resolved.kind === "informationWidget" && <InformationWidget widget={resolved.widget} style="clean" />}
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
      {resolved.kind === "informationWidget" && <InformationWidget widget={resolved.widget} style="clean" />}
      {resolved.kind === "bookmark" && (
        <ul className="studio-native-list">
          <BookmarkItem bookmark={resolved.bookmark} />
        </ul>
      )}
    </ErrorBoundary>
  );
});

function withOverride(resolved, override) {
  if (!resolved || !override) return resolved;
  // The draft is the whole link, so a field it leaves out is shown as gone.
  if (resolved.kind === "service") return { ...resolved, service: { ...resolved.service, ...override } };
  if (resolved.kind === "bookmark") return { ...resolved, bookmark: { ...resolved.bookmark, ...override } };
  return resolved;
}
