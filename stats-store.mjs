// Сховище лічильників на Vercel: сумісне з Upstash Redis / Vercel KV через REST.
// Якщо сховище не підключене, сайт працює далі — лічильники просто порожні.
const BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const KEY = "kyiv-stats";

export const statsStoreReady = () => !!(BASE && TOKEN);

async function cmd(args) {
  const r = await fetch(BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error("storage " + r.status);
  const j = await r.json();
  if (j && j.error) throw new Error("storage error");
  return j ? j.result : null;
}

export async function readStats() {
  if (!statsStoreReady()) return null;
  const r = await fetch(`${BASE}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error("storage " + r.status);
  const j = await r.json();
  const raw = j ? j.result : null;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function writeStats(state) {
  if (!statsStoreReady()) throw new Error("storage not configured");
  await cmd(["SET", KEY, JSON.stringify(state)]);
}
