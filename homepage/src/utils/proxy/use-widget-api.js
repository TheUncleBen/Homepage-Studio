import { useContext } from "react";
import useSWR from "swr";

import { formatProxyUrl } from "./api-helpers";

import { CardLookContext } from "components/studio/card-look";

export default function useWidgetAPI(widget, endpoint, queryParams, swrConfig = {}) {
  const config = { ...swrConfig };
  if (queryParams?.refreshInterval) {
    config.refreshInterval = queryParams.refreshInterval;
  }
  // A Studio widget's own refresh (Behaviour › Refresh) replaces the
  // integration's interval; Auto keeps the integration's own.
  const card = useContext(CardLookContext);
  if (card?.refreshMs) config.refreshInterval = card.refreshMs;
  let url = formatProxyUrl(widget, endpoint, queryParams);
  if (endpoint === "") {
    url = null;
  }
  const { data, error, mutate } = useSWR(url, config);
  // make the data error the top-level error
  return { data, error: data?.error ?? error, mutate };
}
