// Повітряні тривоги для мапи: області та райони.
// Джерела визначаються тут; у відповідь API вони не потрапляють.
const SOURCES = [
  () => process.env.UKRAINEALARM_API_KEY && { url: "https://api.ukrainealarm.com/api/v3/alerts", headers: { Authorization: process.env.UKRAINEALARM_API_KEY } },
  () => ({ url: "https://siren.pp.ua/api/v3/alerts", headers: {} }),
];
const rank = { Yellow: 1, Red: 2 };
const top = (a, b) => ((rank[b] || 0) > (rank[a] || 0) ? b : a);

function levelOf(alert) {
  let lv = null;
  const levels = alert.activeAlertLevels?.length ? alert.activeAlertLevels : [{ alertLevel: "Red" }];
  for (const l of levels) lv = top(lv, rank[l.alertLevel] ? l.alertLevel : "Red");
  return lv;
}

export function parseAlerts(data, now = Date.now()) {
  if (!Array.isArray(data) || data.some((r) => !r || !r.regionId || !r.regionName || !Array.isArray(r.activeAlerts))) throw new Error("bad payload");
  const states = {}, districts = {}, names = {};
  for (const r of data) names[r.regionId] = r.regionName;
  for (const r of data) {
    for (const a of r.activeAlerts) {
      if (a.type && a.type !== "AIR") continue;
      const id = a.regionId || r.regionId, type = a.regionType || r.regionType;
      let name = names[id];
      const lv = levelOf(a);
      if (!name || !lv) continue;
      if (type === "State") {
        if (name === "Київ" || name === "м.Київ") name = "м. Київ";
        states[name] = top(states[name], lv);
      } else if (type === "District") districts[name] = top(districts[name], lv);
    }
  }
  return { updated: new Date(now).toISOString(), states, districts };
}

let cache = null, pending = null;

export async function getAlerts() {
  if (cache && Date.now() - Date.parse(cache.updated) < 15000) return cache;
  if (pending) return pending;
  pending = (async () => {
    let err;
    const sources = SOURCES.map((s) => s()).filter(Boolean);
    for (const src of sources) {
      try {
        const r = await fetch(src.url, { headers: { Accept: "application/json", ...src.headers }, signal: AbortSignal.timeout(sources.length > 1 ? 2500 : 5000) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        cache = parseAlerts(await r.json());
        return cache;
      } catch (e) { err = e; }
    }
    // Недоступність не означає відбій. Застарілий кеш не видаємо за свіжий.
    throw err || new Error("no source");
  })();
  try { return await pending; } finally { pending = null; }
}
