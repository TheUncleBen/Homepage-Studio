import { searchProviders } from "components/widgets/search/search";
import { withAuth } from "utils/auth";
import { widgetsFromConfig } from "utils/config/widget-helpers";
import { cachedRequest } from "utils/proxy/http";

async function handler(req, res) {
  const { query, providerName } = req.query;

  const known = Object.values(searchProviders).find(({ name }) => name === providerName);

  if (!known) {
    return res.json([query, []]);
  }

  // A copy, so a custom address never sticks to the shared provider list.
  const provider = { ...known };
  if (provider.name === "Custom") {
    const widgets = await widgetsFromConfig();
    const searchWidget = widgets.find((w) => w.type === "search");
    provider.suggestionUrl = searchWidget?.options?.suggestionUrl;
  }

  if (!provider.suggestionUrl) {
    return res.json([query, []]); // Responde with the same array format but with no suggestions.
  }

  return res.send(await cachedRequest(`${provider.suggestionUrl}${encodeURIComponent(query)}`, 5, "Mozilla/5.0"));
}

export default withAuth(handler);
