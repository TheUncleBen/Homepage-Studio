import { withAuth } from "utils/auth";
import { discoverySourcesResponse } from "utils/studio/discovery-sources";

async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "private, no-store");
  try {
    return res.status(200).json(await discoverySourcesResponse());
  } catch {
    return res
      .status(503)
      .json({ error: "Native discovery is temporarily unavailable." });
  }
}

export default withAuth(handler);
