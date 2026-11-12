import { getAlerts } from "../server/alerts.mjs";
import { sendJson } from "../server/http.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method not allowed" }, null);
  try {
    sendJson(res, 200, await getAlerts(), [15, 30]);
  } catch {
    sendJson(res, 502, { error: "alerts unavailable" }, null);
  }
}
