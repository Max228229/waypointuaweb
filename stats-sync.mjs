import Anthropic from "@anthropic-ai/sdk";
import { page } from "../server/lib/tg.mjs";
import { readStats, writeStats, statsStoreReady } from "../server/stats-store.mjs";
import { sendJson } from "../server/http.mjs";

const KEYS = ["bal", "cru", "kinj", "uav"];
const PROMPT = `Ти аналізуєш повідомлення Київської міської військової адміністрації.
Якщо це ПІДСУМКОВЕ повідомлення про атаку саме на місто Київ, де названо кількість засобів ураження, поверни їх кількість.
Якщо це не підсумок (попередження, тривога, наслідки без чисел, проміжне оновлення) — final=false.
Відповідай лише JSON: {"final":bool,"bal":int,"cru":int,"kinj":int,"uav":int}
bal — балістичні (Іскандер-М, KN-23, С-300, С-400), cru — крилаті (Х-101, Калібр, Іскандер-К, Х-59/69), kinj — Кинджал, uav — ударні дрони.`;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method not allowed" }, null);
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return sendJson(res, 401, { error: "unauthorized" }, null);
  if (!statsStoreReady()) return sendJson(res, 200, { skipped: "storage" }, null);
  if (!process.env.ANTHROPIC_API_KEY) return sendJson(res, 200, { skipped: "ai" }, null);

  try {
    const st = (await readStats()) || { lastId: 0, add: {}, since: null, seen: [] };
    let msgs = await page("VA_Kyiv");
    if (msgs.length) msgs = (await page("VA_Kyiv", Math.min(...msgs.map((m) => m.id))).catch(() => [])).concat(msgs);
    const seen = new Set();
    msgs = msgs.filter((m) => !seen.has(m.id) && seen.add(m.id)).sort((a, b) => a.id - b.id);
    if (!msgs.length) return sendJson(res, 200, { added: 0 }, null);

    const ai = new Anthropic();
    const fresh = msgs.filter((m) => m.id > st.lastId && /ракет|балістичн|Кинджал|БпЛА|дрон|С-400/i.test(m.text));
    let added = 0;
    for (const m of fresh) {
      try {
        const r = await ai.messages.create({ model: "claude-haiku-5-5", max_tokens: 120, system: PROMPT, messages: [{ role: "user", content: m.text.slice(0, 3000) }] });
        const j = JSON.parse(r.content[0].text.match(/\{[\s\S]*\}/)[0]);
        if (j.final) {
          for (const k of KEYS) st.add[k] = (st.add[k] || 0) + Math.max(0, Math.min(1000, j[k] | 0));
          added++;
        }
      } catch { /* одне повідомлення не розібрали — решта продовжує */ }
    }
    st.lastId = Math.max(st.lastId, ...msgs.map((m) => m.id));
    st.since ||= msgs[0].time;
    st.updated = new Date().toISOString();
    await writeStats(st);
    sendJson(res, 200, { added }, null);
  } catch {
    sendJson(res, 502, { error: "sync unavailable" }, null);
  }
}
