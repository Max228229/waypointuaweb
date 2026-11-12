import { readStats } from "../server/stats-store.mjs";
import { sendJson } from "../server/http.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method not allowed" }, null);
  let st = null;
  try { st = await readStats(); } catch { /* сховище тимчасово недоступне — віддаємо порожні лічильники */ }
  sendJson(res, 200, { add: (st && st.add) || {}, since: (st && st.since) || null, updated: (st && st.updated) || null }, [300, 600]);
}
