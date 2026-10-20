import { withAuth } from "utils/auth";

export const UPSTREAM_COMMIT = "51cc1684f9f34a7877ed462b8f94c9cc687b4dde";

function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    protocolVersion: 1,
    upstreamCommit: UPSTREAM_COMMIT,
    buildRevision: process.env.STUDIO_BUILD_REVISION || "unreleased",
  });
}

export default withAuth(handler);
