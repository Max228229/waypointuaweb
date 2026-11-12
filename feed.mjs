import { buildFeed } from "../server/feed.mjs";
import { sendJson } from "../server/http.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method not allowed" }, null);
  try {
    sendJson(res, 200, await buildFeed(), [20, 40]);
  } catch {
    sendJson(res, 502, { error: "feed unavailable" }, null);
  }
}
