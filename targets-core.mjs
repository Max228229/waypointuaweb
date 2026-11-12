// Ядро стріму цілей: канали + точні координати + тривоги.
// Використовується серверними функціями Vercel; назви джерел у відповідь не потрапляють.
import { page } from "./lib/tg.mjs";
import { track } from "./lib/targets.mjs";
import { fetchAirspace, fromAirspace, combine, posAtNow } from "./lib/airspace.mjs";
import { getAlerts } from "./alerts.mjs";
import { inZone } from "./lib/zone.mjs";
import { BALLISTIC_CHANNELS, GENERAL_CHANNELS } from "./lib/channels.mjs";

const WINDOW_MIN = 90;
const DEDUP_MS = 120000; // однаковий текст із різних каналів протягом 2 хв — одне повідомлення
const DEADLINE_MS = 8500; // бюджет часу: відповідь має встигнути до ліміту функції
const TG_TTL_MS = 20000; // канали опитуємо не частіше 20 с
const AIR_TTL_MS = 8000; // точні координати кешуємо на час між опитуваннями клієнта

let tgCache = { at: 0, ok: false, list: [] };
let airCache = { at: 0, data: null };
let airPending = null;

const norm = (s) => s.toLowerCase().replace(/[’'ʼ`]/g, "").replace(/ё/g, "е").replace(/[іїы]/g, "и").replace(/[єэ]/g, "е").replace(/ґ/g, "г").replace(/ъ/g, "").replace(/[^a-zа-я0-9]+/g, " ").trim();

function getAir(now) {
  if (airCache.data && now - airCache.at < AIR_TTL_MS) return Promise.resolve(airCache.data);
  if (airPending) return airPending;
  airPending = fetchAirspace(6000)
    .then((d) => {
      if (d) airCache = { at: Date.now(), data: d };
      return d;
    })
    .finally(() => { airPending = null; });
  return airPending;
}

export function merge(all, now = Date.now()) {
  const seen = new Set(), byText = new Map(), out = [];
  const from = now - WINDOW_MIN * 60000;
  const msgs = all
    .filter((m) => m && m.text && Date.parse(m.time) >= from && Date.parse(m.time) <= now + 60000)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  for (const m of msgs) {
    const key = m.ch + ":" + m.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = Date.parse(m.time);
    // багаторядкові пости — кожен рядок окремий звіт; рекламні рядки відкидаємо
    for (const line of m.text.split(/\n+/)) {
      const raw = line.trim();
      if (!raw || /@|t\.me\/|підпис|подпис|https?:\/\/|триво|:\s*$/i.test(raw)) continue;
      const text = norm(raw);
      if (!text) continue;
      const prev = byText.get(text);
      if (prev !== undefined && t - prev <= DEDUP_MS) continue; // дубль з іншого каналу
      byText.set(text, t);
      out.push({ time: m.time, text: raw, role: m.role });
    }
  }
  // синтетичні id: трекер сортує за id, а id різних каналів між собою не пов'язані
  return out.map((m, i) => ({
    id: i + 1, time: m.time, text: m.text,
    hint: m.role === "ballistic" ? { type: "ballistic", name: "Балістична ракета", missile: true } : null,
  }));
}

export async function buildTargets(now = Date.now()) {
  // точні координати/курси — ОСНОВНЕ джерело; тривоги й канали — паралельно
  const airJob = getAir(now);
  const alertsJob = getAlerts().catch(() => null);
  if (now - tgCache.at > TG_TTL_MS) {
    const chans = [
      ...BALLISTIC_CHANNELS.map((h) => ({ h, role: "ballistic" })),
      ...GENERAL_CHANNELS.map((h) => ({ h, role: "general" })),
    ];
    const bag = [];
    const jobs = chans.map((c) => (async () => {
      try {
        const p1 = await page(c.h);
        for (const m of p1) bag.push({ ...m, ch: c.h, role: c.role });
        const oldest = Math.min(...p1.map((m) => Date.parse(m.time)));
        if (p1.length >= 18 && oldest > Date.now() - WINDOW_MIN * 60000) {
          const p2 = await page(c.h, Math.min(...p1.map((m) => m.id))).catch(() => []);
          for (const m of p2) bag.push({ ...m, ch: c.h, role: c.role });
        }
      } catch { /* канал недоступний — пропускаємо */ }
    })());
    await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, DEADLINE_MS))]);
    tgCache = { at: now, ok: bag.length > 0, list: bag.length ? track(merge(bag, now), now, WINDOW_MIN, { withEvidence: true }) : [] };
  }
  const rawAir = await airJob;
  const alerts = await alertsJob;
  // null — джерело точних цілей недоступне: не підміняємо його вгадуваннями
  if (rawAir === null) throw new Error("primary unavailable");
  const air = fromAirspace(rawAir, Date.now());
  // зона відповідальності: показуємо цілі ЛИШЕ в областях, що є на мапі
  const tNow = Date.now();
  const targets = combine(tgCache.list, air, tNow, alerts, tgCache.list.evidence || null)
    .filter((t) => {
      const p = posAtNow(t, tNow);
      return inZone(p[0], p[1]);
    })
    .map(({ explicitAt, explicitLL, ...t }) => t);
  return { updated: new Date().toISOString(), targets };
}
