// Додаткове джерело координат цілей: відкрите API повітряної обстановки.
// Беремо ЛИШЕ позицію, азимут (курс) і тип цілі — дизайн, модельки та іконки власні.
// Конвертуємо у внутрішній формат трекера: ціль летить уздовж азимуту на реальній
// швидкості типу, між оновленнями клієнт плавно інтерполює перегін.
import { TYPES, dist } from "./targets.mjs";
import { PLACES } from "./places.mjs";
import { inZone, inGeometry } from "./zone.mjs";
import { ALERT_ZONES } from "./alert-zones.mjs";

const API = "https://api.dimap.live/api/targets";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const STALE_MS = 10 * 60000; // старіше 10 хв — неціль, пропускаємо
const SLOW_HORIZON = 6 * 60000; // горизонт екстраполяції дрона (як IDLE_SLOW у трекері)

// тип джерела -> [внутрішній тип, назва, швидкість км/с (якщо відрізняється від типової)].
// Швидкості — за реальними ТТХ, як у трекері; поле швидкості джерела шумне, не беремо.
const MAP = {
  // реактивні дрони
  reactive_shahed: ["jet", "Реактивний дрон (Герань-3)"],
  geran3: ["jet", "Герань-3 (реактивна)"],
  geran5: ["jet", "Герань-5 (реактивна)"],
  molniya1: ["jet", "Молнія"], molniya2: ["jet", "Молнія"],
  molnia1: ["jet", "Молнія"], molnia2: ["jet", "Молнія"],
  // моторні дрони
  shahed: ["shahed", "Шахед (Герань-2)"],
  shakhed: ["shahed", "Шахед (Герань-2)"],
  geran1_shahed131: ["shahed", "Шахед (Герань-1)"],
  geran2_shahed136: ["shahed", "Шахед (Герань-2)"],
  banderol: ["shahed", "Бандероль"],
  // невстановлені
  fpv: ["unknown", "БпЛА (невстановлений тип)"],
  dron: ["unknown", "Неопізнана ціль"],
  lancet: ["unknown", "Ланцет"],
  // крилаті ракети
  kalibr: ["cruise", "Калібр"],
  kh101: ["cruise", "Х-101", 0.2], x101: ["cruise", "Х-101", 0.2],
  kh55: ["cruise", "Х-55"], x55: ["cruise", "Х-55"],
  kh555: ["cruise", "Х-555"], x555: ["cruise", "Х-555"],
  kh59: ["cruise", "Х-59"], x59: ["cruise", "Х-59"],
  kh69: ["cruise", "Х-69"], x69: ["cruise", "Х-69"],
  kh31: ["cruise", "Х-31"], x31: ["cruise", "Х-31"],
  kh22: ["cruise", "Х-22", 1.0], x22: ["cruise", "Х-22", 1.0],
  iskander_k: ["cruise", "Іскандер-К"],
  cruise: ["cruise", "Крилата ракета"],
  rocket: ["cruise", "Ракета"],
  missile: ["cruise", "Ракета"],
  oniks: ["cruise", "Р-800 «Онікс»", 0.75],
  p800_oniks: ["cruise", "Р-800 «Онікс»", 0.75],
  p800: ["cruise", "Р-800 «Онікс»", 0.75],
  // балістика
  ballistic: ["ballistic", "Балістична ракета"],
  iskander: ["ballistic", "Іскандер-М", 0.9],
  kinzhal: ["ballistic", "Кинджал", 1.0], kingal: ["ballistic", "Кинджал", 1.0],
  kh47m2: ["ballistic", "Кинджал", 1.0], x47m2: ["ballistic", "Кинджал", 1.0],
  tsirkon: ["ballistic", "Циркон", 1.2], curkon: ["ballistic", "Циркон", 1.2],
  zircon: ["ballistic", "Циркон", 1.2],
  // керовані авіабомби
  kab: ["kab", "КАБ (керована авіабомба)"],
  kab_ympk: ["kab", "КАБ (керована авіабомба)"],
  kabumpk: ["kab", "КАБ (керована авіабомба)"],
  kabympk: ["kab", "КАБ (керована авіабомба)"],
  ympd_d30cn: ["kab", "КАБ (керована авіабомба)"],
  ympd30cn: ["kab", "КАБ (керована авіабомба)"],
  ympbd30sn: ["kab", "КАБ (керована авіабомба)"],
};
// літаки, гелікоптери, човни, розвідка й попередження — не цілі удару, пропускаємо
const fallback = (k) => {
  if (/reactive|geran[35]/.test(k)) return ["jet", "Реактивний дрон (Герань-3)"];
  if (/shahed|shakhed|geran/.test(k)) return ["shahed", "Шахед (Герань-2)"];
  return null;
};

/* ---------- геометрія ---------- */
const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
const r5 = (x) => Math.round(x * 1e5) / 1e5;
function offset(p, bearingDeg, km) {
  const b = rad(bearingDeg), dl = (km / R) * Math.cos(b), dg = ((km / R) * Math.sin(b)) / Math.cos(rad(p[0]));
  return [p[0] + (dl * 180) / Math.PI, p[1] + (dg * 180) / Math.PI];
}
export function posAtNow(tg, now) {
  const p = tg.pts;
  if (now <= p[0][2]) return [p[0][0], p[0][1]];
  for (let i = 1; i < p.length; i++) {
    if (now <= p[i][2]) {
      const f = (now - p[i - 1][2]) / Math.max(1, p[i][2] - p[i - 1][2]);
      return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f];
    }
  }
  const l = p[p.length - 1];
  return [l[0], l[1]];
}
// найближча відома точка (для підпису «Остання точка»), не далі 25 км
function nearestName(ll) {
  let best = null, bd = 25;
  for (const [name, lat, lng] of PLACES) {
    const d = dist(ll, [lat, lng]);
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

/* ---------- отримання ---------- */
// null — джерело недоступне (це НЕ «цілей немає»); [] — достовірна порожня відповідь.
export async function fetchAirspace(timeoutMs = 6000) {
  try {
    const r = await fetch(API + "?_refresh=" + Date.now(), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j.targets) ? j.targets : null;
  } catch {
    return null;
  }
}

/* ---------- конвертація у формат трекера ---------- */
export function fromAirspace(raw, now = Date.now()) {
  const list = [], seen = new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r !== "object") continue;
    const rid = r.id != null ? String(r.id) : "";
    if (rid && seen.has(rid)) continue; // дубль того самого запису, не різна ціль
    if (rid) seen.add(rid);
    const m = MAP[String(r.type || "").toLowerCase()] || fallback(String(r.type || "").toLowerCase());
    if (!m) continue;
    const lat = +r.lat, lng = +r.lng;
    if (!isFinite(lat) || !isFinite(lng) || !inZone(lat, lng)) continue; // лише зона відповідальності мапи
    let t0 = Date.parse(r.lastSeen);
    if (!isFinite(t0)) t0 = now;
    t0 = Math.min(t0, now);
    if (now - t0 > STALE_MS) continue;
    const [type, name, spd0] = m;
    const cfg = TYPES[type];
    const spd = spd0 || cfg.speed;
    // азимут 0 — це ПІВНІЧ, а не «нема курсу»; відсутній лише null/не число
    const hasB = r.bearing != null && isFinite(+r.bearing);
    const tEnd = Math.max(t0, now) + (cfg.slow ? SLOW_HORIZON : cfg.life * 1000);
    let pts;
    if (!hasB) pts = [[lat, lng, t0]]; // позиційна ціль без курсу — чекає на уточнення
    else {
      const b = ((+r.bearing % 360) + 360) % 360;
      const e = offset([lat, lng], b, spd * ((tEnd - t0) / 1000));
      pts = [[lat, lng, t0], [e[0], e[1], tEnd]];
    }
    const last = nearestName([lat, lng]);
    const alt = r.altitude != null && isFinite(+r.altitude) ? Math.round(+r.altitude) : null;
    list.push({
      id: 100000 + list.length + 1, type, name, count: 1, alt,
      pts: pts.map((p) => [r5(p[0]), r5(p[1]), Math.round(p[2])]),
      last, dest: null, route: last ? [last] : [],
      updated: t0, speed: spd, slow: !!cfg.slow,
    });
  }
  // Різні записи — різні цілі, навіть якщо стоять поруч. Об'єднуємо лише повний
  // дубль (той самий тип, місце й час), а не сусідні реальні цілі.
  const kept = [];
  for (const x of list.sort((a, b) => b.updated - a.updated)) {
    const dup = kept.find((k) => k.type === x.type && k.updated === x.updated && dist(k.pts[0], x.pts[0]) <= 0.3);
    if (!dup) kept.push(x);
  }
  return kept;
}

/* ---------- злиття з цілями трекера ---------- */
// Точні координати — ОСНОВНИЙ список і показуються завжди.
// Повідомлення каналів — лише доповнення: підтверджують/знімають точну ціль або
// додають нову, але тільки якщо є свіжий явний репорт у районі, де зараз реально
// діє тривога. Старі екстраполяції й «голі» назви місць на мапу не потрапляють.
const nkey = (s) => String(s || "").toLowerCase()
  .replace(/м\.\s*/g, "")
  .replace(/(область|обл\.|район|р-н)/g, "")
  .replace(/[^a-zа-яіїєґ]/g, "");
const ZONES = ALERT_ZONES.map((z) => ({ n: nkey(z.n), s: nkey(z.s), g: z.g }));
const ALERT_MAX_AGE = 150000;

export function alertContext(alerts, now = Date.now()) {
  if (!alerts || !alerts.updated) return null;
  const at = Date.parse(alerts.updated);
  if (!isFinite(at)) return null;
  const keys = new Set([
    ...Object.keys(alerts.states || {}),
    ...Object.keys(alerts.districts || {}),
  ].map(nkey).filter(Boolean));
  return { keys, fresh: now - at <= ALERT_MAX_AGE };
}
function localAlert(ctx, ll) {
  if (!ctx || !ctx.fresh || !ll) return false;
  for (const z of ZONES) {
    if (!z.n) continue;
    if (!inGeometry(z.g, ll[0], ll[1])) continue;
    if (ctx.keys.has(z.n) || (z.s && ctx.keys.has(z.s))) return true;
  }
  return false;
}

export function combine(tg, dm, now = Date.now(), alerts = null, evidence = null) {
  const compatible = (a, b) => {
    if (!a || !b || !TYPES[a.type] || !TYPES[b.type]) return false;
    const sa = TYPES[a.type].slow, sb = TYPES[b.type].slow;
    if (sa !== sb) return false;
    if (!sa) return a.type === b.type;
    if ((a.type === "shahed" && b.type === "jet") || (a.type === "jet" && b.type === "shahed")) return false;
    return true;
  };
  const ctx = alertContext(alerts, now);
  const primary = (Array.isArray(dm) ? dm : []).filter((d) => !!TYPES[d.type]);
  const removals = (evidence && Array.isArray(evidence.removals) ? evidence.removals : []).filter((r) => r && r.ll);
  // збиття/зникнення з місцем знімає лише СВІЖУ точну ціль поблизу, не глобально
  const remHit = (r, d) => {
    if (!TYPES[d.type]) return false;
    if (!r.type) return true; // тип не названо — знімаємо будь-яку ціль поблизу
    if (r.type === "unknown") return TYPES[d.type].slow && d.type !== "jet"; // «шахед» ≠ реактивний
    return compatible({ type: r.type }, d);
  };
  const keptPrimary = primary.filter((d) =>
    !removals.some((r) => r.at >= (d.updated || 0)
      && remHit(r, d)
      && dist(r.ll, posAtNow(d, now)) <= (TYPES[d.type].slow ? 15 : 35)));

  const supp = [];
  for (const x of Array.isArray(tg) ? tg : []) {
    if (!x || !TYPES[x.type] || !x.explicitAt || !x.explicitLL) continue;
    if (now - x.explicitAt > 15 * 60000) continue; // явний репорт застарий
    if (now - x.updated > (TYPES[x.type].slow ? 3 * 60000 : 2 * 60000)) continue; // трек не підтверджено
    if (!localAlert(ctx, x.explicitLL)) continue; // немає свіжої тривоги там, де ціль бачили
    const cur = posAtNow(x, now);
    if (keptPrimary.some((d) => compatible(x, d)
      && dist(cur, posAtNow(d, now)) <= (TYPES[x.type].slow ? 12 : 30))) continue; // уже є точна
    if (supp.some((k) => compatible(x, k) && dist(cur, posAtNow(k, now)) <= 5)) continue;
    supp.push(x);
  }
  return [...keptPrimary, ...supp].map(({ explicitAt, explicitLL, ...t }, i) => ({ ...t, id: i + 1 }));
}