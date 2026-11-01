import { useContext, useEffect } from "react";
import useSWR from "swr";

import { formatProxyUrl } from "./api-helpers";

import { CardLookContext, cardLive } from "components/studio/card-look";

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
  // Let the card refresh this request now and say how fresh its data is.
  const cardId = card?.id;
  const interval = config.refreshInterval || 0;
  useEffect(() => {
    if (!cardId || !url) return undefined;
    const live = cardLive(cardId);
    const refresh = () => mutate();
    live.refreshers.set(url, refresh);
    live.interval = Math.max(live.interval, interval);
    return () => {
      if (live.refreshers.get(url) === refresh) live.refreshers.delete(url);
    };
  }, [cardId, url, mutate, interval]);
  useEffect(() => {
    if (cardId && data !== undefined && !data?.error) cardLive(cardId).updatedAt = Date.now();
  }, [cardId, data]);
  // make the data error the top-level error
  return { data, error: data?.error ?? error, mutate };
}
