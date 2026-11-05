import { useContext } from "react";

import { CardLookContext } from "components/studio/card-look";
import { CollectContext } from "utils/studio/collect-context";

export default function withWidgetFields(service, defaultFields, maxFields = 4) {
  const configuredFields = service.widget.fields;
  const fields = (configuredFields?.length ? configuredFields : defaultFields).slice(0, maxFields);

  return {
    ...service,
    widget: {
      ...service.widget,
      fields,
    },
  };
}

// Studio: inside a Studio card (and when chart history reads a widget), the
// card arranges and folds the values itself, so Homepage's limit on how many a
// widget shows does not apply. Owner request, 4 Nov 2026.
export function useUncappedFields() {
  const card = useContext(CardLookContext);
  const collect = useContext(CollectContext);
  return Boolean(card || collect);
}

export function useWidgetFields(service, defaultFields, maxFields = 4) {
  const uncapped = useUncappedFields();
  return withWidgetFields(service, defaultFields, uncapped ? Infinity : maxFields);
}
