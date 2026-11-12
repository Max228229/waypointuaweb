import { page } from "./lib/tg.mjs";

const TTL_MS = 20000;
let cache = { at: 0, data: null };

export async function buildFeed() {
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;
  let msgs = await page("waypoint_ua");
  if (msgs.length) msgs = (await page("waypoint_ua", Math.min(...msgs.map((m) => m.id))).catch(() => [])).concat(msgs);
  const seen = new Set();
  msgs = msgs.filter((m) => !seen.has(m.id) && seen.add(m.id)).sort((a, b) => a.id - b.id);
  cache = { at: Date.now(), data: msgs };
  return msgs;
}
