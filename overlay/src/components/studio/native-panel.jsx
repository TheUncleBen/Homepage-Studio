import { memo } from "react";

import { resolveNativePanel } from "./native-adapter.mjs";

import BookmarkItem from "components/bookmarks/item";
import ErrorBoundary from "components/errorboundry";
import ServiceItem from "components/services/item";
import ServiceWidget from "components/services/widget";
import InformationWidget from "components/widgets/widget";

export default memo(function NativePanel({ panel, data }) {
  const resolved = resolveNativePanel(panel, data);
  if (!resolved)
    return (
      <div className="studio-panel-placeholder">
        <strong>Content unavailable</strong>
        <p>
          Its native configuration could not be matched. Open Edit to review the
          source.
        </p>
      </div>
    );
  return (
    <ErrorBoundary>
      {resolved.kind === "service" && (
        <ul className="studio-native-list">
          <ServiceItem
            service={resolved.service}
            groupName={resolved.groupName}
            useEqualHeights
          />
        </ul>
      )}
      {resolved.kind === "serviceWidget" && (
        <ServiceWidget widget={resolved.widget} service={resolved.service} />
      )}
      {resolved.kind === "informationWidget" && (
        <InformationWidget widget={resolved.widget} style="clean" />
      )}
      {resolved.kind === "bookmark" && (
        <ul className="studio-native-list">
          <BookmarkItem bookmark={resolved.bookmark} />
        </ul>
      )}
    </ErrorBoundary>
  );
});
