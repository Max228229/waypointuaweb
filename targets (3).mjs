// Відстеження цілей за короткими повідомленнями каналу («Бровари», «реактив на Васильків», «3 на Трипілля», «Нема»…).
// НАЗВАНА ТОЧКА — НЕ ЦІЛЬ УДАРУ: це лише путова точка на курсі. Ціль пролітає крізь
// усі названі точки В ПОРЯДКУ ТЕКСТУ («на Борисполь курсом на Бортничи» = Бориспіль → Бортничі)
// і летить ДАЛІ по встановленому курсу, поки не прийде новий репорт або не спливе час.
// Зміна курсу — плавний доворот від поточної позиції на реальній швидкості, без телепорту.
import { PLACES } from "./places.mjs";

const norm = (s) => s.toLowerCase().replace(/[’'ʼ`]/g, "").replace(/ё/g, "е").replace(/[іїы]/g, "и").replace(/[єэ]/g, "е").replace(/ґ/g, "г").replace(/ъ/g, "");
const tokens = (s) => norm(s).split(/[^a-zа-я0-9]+/).filter(Boolean);

/* ---------- довідник місць ---------- */
const auto = (name) => {
  return tokens(name).map((w) => {
    let p = w.endsWith("ив") ? w.slice(0, -2) : w.endsWith("иль") ? w.slice(0, -3) : w.replace(/[аеиоуяюйь]+$/, "");
    if (p.length < 4) p = w + "=";
    return p;
  }).join(" ");
};
const ALIASES = [];
for (const [name, lat, lng, al] of PLACES) {
  for (const a of (al || auto(name)).split("|")) {
    const words = a.trim().split(/\s+/).map((w) => {
      const m = w.match(/^(.*?)(=|\*|~(\d))?$/);
      return { p: m[1], max: m[2] === "=" ? 0 : m[2] === "*" ? 99 : m[3] ? +m[3] : 5 };
    });
    ALIASES.push({ name, lat, lng, words, w: words.reduce((s, x) => s + x.p.length, 0) });
  }
}
ALIASES.sort((a, b) => b.words.length - a.words.length || b.w - a.w);
const wm = (tok, w) => tok.startsWith(w.p) && tok.length - w.p.length <= w.max;

function findPlaces(toks) {
  const used = new Array(toks.length).fill(false), out = [];
  for (const a of ALIASES) {
    for (let i = 0; i + a.words.length <= toks.length; i++) {
      let ok = true;
      for (let k = 0; k < a.words.length && ok; k++) ok = !used[i + k] && wm(toks[i + k], a.words[k]);
      if (!ok) continue;
      for (let k = 0; k < a.words.length; k++) used[i + k] = true;
      out.push({ i, n: a.words.length, name: a.name, ll: [a.lat, a.lng] });
    }
  }
  return { list: out.sort((a, b) => a.i - b.i), used };
}

/* ---------- типи цілей ---------- */
// Швидкість у км/с відповідає реальних ТТХ, щоб ціль летіла по мапі «як у житті»:
// Герань-2 ≈ 180 км/год, Герань-3 (реактивна) ≈ 500 км/год, крилата ≈ 900 км/год.
export const TYPES = {
  shahed: { speed: 0.05, spawn: 6, life: 25 * 60, slow: true },
  jet: { speed: 0.14, spawn: 8, life: 15 * 60, slow: true },
  unknown: { speed: 0.05, spawn: 6, life: 15 * 60, slow: true },
  cruise: { speed: 0.25, spawn: 8, life: 120 },
  ballistic: { speed: 0.6, spawn: 25, life: 120 },
  kab: { speed: 0.22, spawn: 12, life: 90 },
};
const DEFAULT_NAME = { shahed: "Шахед (Герань-2)", jet: "Реактивний дрон (Герань-3)", unknown: "Неопізнана ціль", cruise: "Крилата ракета", ballistic: "Балістична ракета", kab: "КАБ (керована авіабомба)" };

// Тип цілі за текстом. Важливо: балістику визначаємо ЛИШЕ за повними словами чи
// окремими токенами («бал», «бр»), а не підрядком «бали» — інакше топоніми на кшталт
// «Цимбалів яр» хибно спрацьовують як балістична ракета й плодять фантомні цілі.
// Слова-тригери зібрані з реальних постів усіх підключених каналів.
const word = (t, w) => new RegExp("(^|\\s)" + w + "(\\s|$)").test(t);
// Текст і токени вже нормалізовані (і/ї/ы→и, є/э→е, ґ→г). Щоб українські форми в
// тригерах («далі», «прямує») збігалися з нормалізованим текстом, нормалізуємо й
// сам шаблон регулярки тією ж norm().
const nre = (s) => new RegExp(norm(s));
function typeOf(t) {
  let m;
  if ((m = t.match(/герань\s*[-–]?\s*(\d)/))) {
    const n = +m[1];
    return { type: n === 3 || n === 5 ? "jet" : "shahed", name: `Герань-${n}` + (n === 3 || n === 5 ? " (реактивна)" : "") };
  }
  if (/молни/.test(t)) return { type: "jet", name: "Молнія" };
  if (/реакт|к\s*5\s*к|(^|\s)к5(\s|$)|рбпла/.test(t)) return { type: "jet", name: DEFAULT_NAME.jet };
  if (/двз/.test(t)) return { type: "shahed", name: DEFAULT_NAME.shahed };
  if ((/звичайн|обычн/.test(t)) && /бпла|шахед|дрон/.test(t)) return { type: "shahed", name: DEFAULT_NAME.shahed };
  if (/бандерол/.test(t)) return { type: "shahed", name: DEFAULT_NAME.shahed };
  if (/циркон/.test(t)) return { type: "ballistic", name: "Циркон", missile: true, speed: 1.2 };
  if (/искандер|іскандер/.test(t) && /[-–\s]к(\s|$)/.test(t)) return { type: "cruise", name: "Іскандер-К", missile: true };
  if (/искандер|іскандер/.test(t)) return { type: "ballistic", name: "Іскандер-М", missile: true, speed: 0.9 };
  if (/кинджал|кинжал|х\s*47|х-?47/.test(t)) return { type: "ballistic", name: "Кинджал", missile: true, speed: 1.0 };
  if (/(^|\s)с\s*400(\s|$)|(^|\s)с\s*300(\s|$)|с-?300|с-?400|рм\s*48|48н6/.test(t)) return { type: "ballistic", name: "Ракета С-300/С-400", missile: true, speed: 0.7 };
  if (/точка\s*[-–]?\s*у|отрк/.test(t)) return { type: "ballistic", name: DEFAULT_NAME.ballistic, missile: true };
  if (/балистич|балистик|балистика|баллистич|баллистик/.test(t) || word(t, "бал") || word(t, "бр")) return { type: "ballistic", name: DEFAULT_NAME.ballistic, missile: true };
  if (/мгкр/.test(t)) return { type: "cruise", name: DEFAULT_NAME.cruise, missile: true };
  if (/онікс|оникс|яхонт/.test(t)) return { type: "cruise", name: "Р-800 «Онікс»", missile: true, speed: 0.75 };
  if (/х\s*[-–]?\s*22|х\s*[-–]?\s*32/.test(t)) return { type: "cruise", name: "Х-22", missile: true, speed: 1.0 };
  if (/х\s*[-–]?\s*101/.test(t)) return { type: "cruise", name: "Х-101", missile: true, speed: 0.2 };
  if (word(t, "кр") || word(t, "гкр") || /крилат|калибр|калібр|х\s*55|х-?55|х\s*555|х-?555|х\s*69|х-?69/.test(t)) return { type: "cruise", name: DEFAULT_NAME.cruise, missile: true };
  if (/(^|\s)каб(\s|$)|каби|кабов|керован|авіабомб|авиабомб/.test(t)) return { type: "kab", name: DEFAULT_NAME.kab, missile: true };
  if (/мопед/.test(t)) return { type: "shahed", name: DEFAULT_NAME.shahed };
  // «шахед/герань/БпЛА» без уточнення реактив чи моторний — тип невідомий:
  // ставимо неопізнану ціль, а не вгадуємо. Уточниться пізнішим репортом.
  if (/шахед|шахид|герань|геран|герани|бпла|(^|\s)дрон|дрони/.test(t)) return { type: "unknown", name: DEFAULT_NAME.unknown };
  if (/ракет/.test(t)) return { type: "cruise", name: "Ракета", missile: true, generic: true };
  if (/квадрокоптер/.test(t)) return { type: "unknown", name: "Квадрокоптер" };
  return null;
}

// Службові слова (НЕ зайві). Нормалізуємо так само, як токени, інакше українські
// форми («летить») не збігалися б з нормалізованими токенами («летит»).
const STOP = new Set(("на до над повз через по в у и й та з зи из вид биля район рн р н курс курсом дали ще один одна одного два дви три чотири пять шисть "
  + "вис висота висоти м км кмг увага уважно знову знов а це вже бик нараз зараз там йде иде летить летять пишов пишли полетив полетила пид "
  + "мабуть е ае аеродром пс пидстанция пидстанции тец метро вул вулиця вулици циль цили цилей реактив реакт реактивний реактивна герань "
  + "шахед мопед дрон бпла рбпла ракета ракети ракет балистика бали кр бр всих вси все обидва обох штуки штук групова ициль низько високо "
  + "зниження знижуеться кружляе крутить крутиться розвидуе другий третий четвертий инший новий вилиз вилизло вилизла фикс над пивдни пивночи "
  + "сторону бик зи стороны обл область районе сади лягти бережись ховайтесь ховаемось швидко точно чисто "
  // сполучники й прислівники курсу/часу з реальних постів
  + "дальше далі тепер теперь уже вона він он вони они летит летят прямує прямует направляется направляється слідує следует "
  + "повернув повернула повернули розвернувся развернулся заходить заход залітає залетает змінює меняет змінив сменил продовжує продолжает "
  + "потім потом затем після перед мимо пролітає пролетает пролетів пролетел минул минув обходить обходит огинає огибает "
  + "наведення наведение наводиться наводится перенаправлен перенаправлена вектор вектором напрямку напрям направлении направление "
  + "група групи грп груп ланцюгом ланцюг цепочкой звичайний звичайних обычный обычных двз мгкр бандероль бандероли молния кабі каби каб "
  + "фіксація фиксация зафіксовано зафиксировано багато много залишився лишился останній останний последний одне двоє троє четверо "
  + "нових нова нове новая новое новых раз разу раза місто міста місті город городе город села село селище смт пгт "
  + "станція станция аеропорт аэропорт летовище водосховище водохранилище дамба гребля міст мост мосту моста траса трасса шосе дорога дорозі "
  + "передмістя передмист пригород околиця околица области району районі но але или або ли чи же ж бы б то лише только именно саме прямо прям рівно ровно быстро "
  + "с із зі со от від к ко про для без при "
  // ВЕЛИКИЙ словник службових слів руху/курсу/часу/кількості з реальних постів усіх каналів.
  + "летить летит летять летят иде идет идуть идут рухаеться рухаются движется движутся прямует прямує прямуют направляется направляються направляются следует следуют слідує слідуют "
  + "полетив полетел полетила полетела полетили полетели пишов пошел пишли пошли повертає поворачивает розвертаеться разворачивается змінив сменил змінює меняет перенаправлено перенаправлена продовжує продолжает "
  + "його ее їх их цей ця це той та те ці эти курс курсом вектор вектором напрямку напрям направлении направление сторону бик бок боку стороны район району района обл область области "
  + "до на в у над пид повз через мимо биля возле около поблизу недалеко километрив км метрив м висота висотою висоти ешелон швидкисть скоростью швидко быстро повильно медленно низько низко високо высоко "
  + "група групи груп ланцюг ланцюгом цепочка цепочкой килька несколько багато много один одна одно два дви три чотири пять штук штуки цили цель целей циль цилей зафиксировано зафіксовано фиксация фіксация спостеригаеться наблюдается помечено замечено виявлено обнаружено "
  + "ще и ще один одна новий новый нова новое другий другой третий третій четвертий инший иной вилиз вылез вилизло вылезло").split(" ").map(norm).filter(Boolean));

const NUMW = { один: 1, одна: 1, одне: 1, два: 2, дви: 2, двоє: 2, три: 3, троє: 3, чотири: 4, четверо: 4, пять: 5, шисть: 6, симь: 7, висим: 8 };

/* ---------- геометрія ---------- */
const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
export function dist(a, b) {
  const dl = rad(b[0] - a[0]), dg = rad(b[1] - a[1]);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function offset(p, bearingDeg, km) {
  const b = rad(bearingDeg), dl = (km / R) * Math.cos(b), dg = ((km / R) * Math.sin(b)) / Math.cos(rad(p[0]));
  return [p[0] + (dl * 180) / Math.PI, p[1] + (dg * 180) / Math.PI];
}
function bearing(a, b) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const KYIV = [50.4501, 30.5234];
const r5 = (x) => Math.round(x * 1e5) / 1e5;

function posAt(tg, t) {
  const p = tg.pts;
  if (t <= p[0][2]) return [p[0][0], p[0][1]];
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][2]) {
      const f = (t - p[i - 1][2]) / Math.max(1, p[i][2] - p[i - 1][2]);
      return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f];
    }
  }
  const l = p[p.length - 1];
  return [l[0], l[1]];
}

/* ---------- трекер ---------- */
export function track(messages, now = Date.now(), windowMin = 90, opts = null) {
  const T = [];
  const removals = [];
  let seq = 0, slowHint = null;
  // Ціль живе, лише поки її підтверджують свіжими репортами. Повільні цілі, про які
  // не писали кілька хвилин, зникають (вона або полетіла далі, або її вже немає);
  // ракети й так живуть дуже коротко. Це прибирає «привидів» годинами на мапі.
  const IDLE_SLOW = 6 * 60000;
  // Максимальна тривалість «докрутки» (сек). Звичайні перегони летять у реальному
  // темпі; стискаємо ЛИШЕ великий розрив (>50 км), коли трек помітно відстав.
  const CATCHUP_MAX = 90, CATCHUP_KM = 50;
  const active = (t) => T.filter((x) => !x.gone
    && t - x.updated <= (TYPES[x.type].slow ? IDLE_SLOW : TYPES[x.type].life * 1000)
    && (TYPES[x.type].slow ? t - x.arrive <= TYPES[x.type].life * 1000 : true));

  // Переліт до путової точки. Ціль НЕ зупиняється в ній: після останньої точки
  // трекер продовжить курс. Поворот >25° — плавна дуга (без'є), а не злам стрілки.
  // t — час геометрії (може бути майбутнім для ланцюжка точок), upd — час репорту:
  // updated завжди = час репорту, інакше наступна асоціація бачить «0 секунд».
  function goTo(tg, ll, t, place, upd) {
    const spd = tg.spd || TYPES[tg.type].speed;
    const cur = posAt(tg, t);
    let prevB = null;
    const P = tg.pts;
    if (P.length >= 2) {
      const a = P[P.length - 2], b = P[P.length - 1];
      if (b[2] > a[2] && dist([a[0], a[1]], [b[0], b[1]]) > 0.05) prevB = bearing([a[0], a[1]], [b[0], b[1]]);
    }
    tg.pts = P.filter((p) => p[2] < t);
    tg.pts.push([cur[0], cur[1], t]);
    const d = dist(cur, ll);
    if (d > 0.05) {
      const newB = bearing(cur, ll);
      let dur = d / spd, samples = null;
      if (prevB != null && d > 1.5 && angDiff(prevB, newB) > 25) {
        // спочатку трохи йдемо старим курсом, потім плавно довертаємо на нову точку
        const ctrl = offset(cur, prevB, Math.min(d * 0.5, 12));
        samples = [];
        let L = 0, px = cur;
        const N = 12;
        for (let i = 1; i <= N; i++) {
          const u = i / N, v = 1 - u;
          const x = v * v * cur[0] + 2 * v * u * ctrl[0] + u * u * ll[0];
          const y = v * v * cur[1] + 2 * v * u * ctrl[1] + u * u * ll[1];
          L += dist(px, [x, y]); px = [x, y];
          samples.push([x, y, L]);
        }
        dur = L / spd;
      }
      if (d > CATCHUP_KM) dur = Math.min(dur, CATCHUP_MAX);
      if (samples) {
        const L = samples[samples.length - 1][2];
        for (const s of samples) tg.pts.push([s[0], s[1], t + (s[2] / L) * dur * 1000]);
      } else {
        tg.pts.push([ll[0], ll[1], t + dur * 1000]);
      }
      tg.arrive = t + dur * 1000;
    }
    tg.last = place; tg.dest = null;
    if (tg.route[tg.route.length - 1] !== place) tg.route.push(place);
    tg.updated = upd ?? t;
  }
  // fromLL — точка вильоту («з Житомирщини»); dir — репорт напрямку («НА Оболонь»).
  // СПАВН З УРАХУВАННЯМ КУРСУ: ціль НІКОЛИ не з'являється просто на названій точці —
  // вона породжується ЗА кілька км ДО неї уздовж реалістичного вхідного курсу і
  // пролітає крізь точку далі. Навіть позиційний репорт отримує вхідний курс.
  function inboundBearing(ll) {
    // Типова вісь атаки: ззовні вздовж напрямку Київ→точка (ціль летить у бік Києва),
    // над самим Києвом — східний захід (типовий азимут заходу шахедів).
    return dist(ll, KYIV) < 3 ? 60 : bearing(KYIV, ll);
  }
  function spawn(ty, ll, place, t, count, fromLL, dir) {
    const type = ty.type, cfg = TYPES[type];
    const spd = ty.speed || cfg.speed;
    let start, dur;
    if (fromLL) { start = fromLL; dur = (dist(start, ll) / spd) * 1000; }
    else {
      const b = cfg.slow ? inboundBearing(ll) : 55;
      const lead = cfg.slow ? (dir ? cfg.spawn : Math.max(2, cfg.spawn * 0.6)) : cfg.spawn;
      start = offset(ll, b, lead);
      dur = (dist(start, ll) / spd) * 1000;
    }
    const pts = dur > 0 ? [[start[0], start[1], t], [ll[0], ll[1], t + dur]] : [[ll[0], ll[1], t]];
    const tg = { id: ++seq, type, name: ty.name, spd, count: count || 1, alt: null, pts, arrive: t + dur, created: t, updated: t, route: [], last: null, dest: null };
    tg.last = place; tg.route.push(place);
    T.push(tg);
    return tg;
  }
  const removeOne = (t, ty, near) => {
    let c = active(t).filter((x) => !ty || x.type === ty);
    if (!c.length) return;
    if (near) c.sort((a, b) => dist(posAt(a, t), near) - dist(posAt(b, t), near));
    else c.sort((a, b) => b.updated - a.updated);
    c[0].gone = true;
  };
  // «кружляє над X» — ціль реально обертається навколо точки: коло з рівномірних
  // сегментів у часі, тож клієнт бачить чітке кружляння (ніс обертається, стрілка гнеться).
  function orbit(tg, c, t) {
    const spd = tg.spd || TYPES[tg.type].speed;
    const r = 2.5;
    const cur = posAt(tg, t);
    const a0 = Math.atan2(cur[0] - c[0], cur[1] - c[1]);
    const period = (2 * Math.PI * r) / spd;
    const total = Math.min(6 * 60, period * 2);
    const n = Math.max(24, Math.round((total / period) * 36));
    const pts = [[r5(cur[0]), r5(cur[1]), t]];
    const kLat = r / 111.32, kLng = r / (111.32 * Math.cos(c[0] * Math.PI / 180));
    for (let i = 1; i <= n; i++) {
      const frac = i / n, ang = a0 + frac * (total / period) * 2 * Math.PI;
      pts.push([r5(c[0] + kLat * Math.sin(ang)), r5(c[1] + kLng * Math.cos(ang)), Math.round(t + frac * total * 1000)]);
    }
    tg.pts = pts; tg.arrive = t + total * 1000; tg.updated = t; tg.dest = null;
  }

  const from = now - windowMin * 60000;
  for (const m of [...messages].sort((a, b) => a.id - b.id)) {
    const t = Date.parse(m.time);
    if (!(t >= from && t <= now) || !m.text) continue;
    const text = norm(m.text);
    const circling = /круж|крутит/.test(text);
    if (text.length > 120) continue;
    if (/триво/.test(text)) continue; // рядки про повітряну тривогу — не цілі й не відбій цілей
    // Не-цільові контексти: навчання, фейки, минулі події, наслідки, офіційні зведення.
    if (nre("(навчан|тренув|учен|фейк|fake|дезінформ|дезинформ|помилков|ошибочн|не підтвердж|не подтвержд|вчора|вчера|минуло|прошл|результат|наслідк|последств|застосован|применен|станом на|по состоянию|офіц|офиц|архів|архив|фото|відео|видео)").test(text)) continue;
    const toks = tokens(m.text);
    const { list: places, used } = findPlaces(toks);
    const known = typeOf(text);
    // підказка каналу балістики: «пуск» із місцем, але без типу — балістична ракета.
    // Лише повні слова («балистич», «ракет»), не підрядок «бал» — щоб топоніми не ставали ракетами.
    const ty = known || (m.hint && places.length && /пуск|старт|залп|балистич|балистик|ракет|кинджал|кинжал|искандер|циркон|с\s*[34]00/.test(text) ? m.hint : null);
    if (ty && !ty.missile) slowHint = { ...ty, t };

    /* відбій / чисто */
    if (/видби|(^|\s)чисто|начисто|не бачу|нема ничого|ничого нема|наче все/.test(text)) {
      const onlyMissiles = /видби[а-я]*\s+по\s+(бал|бр|ракет|кр)|по\s+(бал|бр|ракет|кр|мгкр)[а-я]*\s+чисто/.test(text);
      const onlySlow = /видби[а-я]*\s+по\s+(рбпла|бпла|дрон|шахед|бандерол|реакт)|по\s+(бандерол|шахед|дрон|бпла|реактив)[а-я]*\s+чисто/.test(text);
      for (const x of T) if (!x.gone && (onlyMissiles ? !TYPES[x.type].slow : onlySlow ? TYPES[x.type].slow : true)) x.gone = true;
      continue;
    }
    /* збиття / зникнення / вилетів за межі / вибух */
    if (text.length <= 60 && /^(нема|немае)|(^|\s)(зник|знищ|збит|збиття|збили|сбит|сбили|минус|впав|впала|впал|упал|упала|пада|вбили|не спостериг|не фикс|не видно|зняли|влучан|влучив|влучила|прилит|прилет|вибух|взрыв|детонац|разбил|розбил|вилет|за меж|покинул|наче в поли|вихид|виход|перехоплен|перехвачен|пропал|исчез|потеря|уламк|обломк|debris|уничтож)/.test(text)) {
      removeOne(t, ty && !ty.generic ? ty.type : null, places[0] && places[0].ll);
      // свіже місцеве «збито/зник» може знімати й точну ціль (застосуємо при злитті)
      if (places[0]) removals.push({ ll: places[0].ll, type: ty && !ty.generic ? ty.type : null, at: t });
      continue;
    }
    if (text.includes("?")) continue;
    if (/(^|\s)(були|було|йшли|вчора|результат|наслидк|застосовано|станом на|офиц)/.test(text)) continue;
    if (!places.length) continue;

    /* висота й кількість */
    let alt = null, count = 0;
    const am = text.match(/(\d{3,5})\s*(м\b|метр|вис)|(вис[а-я]*)\s*(\d{3,5})|(^|\s)(\d{3,5})(\s|$)/);
    if (am) alt = +(am[1] || am[4] || am[6]);
    toks.forEach((w, i) => {
      if (used[i]) return;
      const xm = w.match(/^(\d+)х$/);
      if (xm && +xm[1] >= 1 && +xm[1] <= 30) count = count || +xm[1];
      else if (/^\d+$/.test(w) && +w >= 1 && +w <= 30 && !/^(м|км|кмг|метр[а-я]*)$/.test(toks[i + 1] || "") && !/^вис/.test(toks[i - 1] || "") && !/^(тец|герань|к)$/.test(toks[i - 1] || "")) count = count || +w;
      else if (NUMW[w] && !count) count = NUMW[w];
    });
    /* зайві слова — це не повідомлення про ціль */
    const extra = toks.filter((w, i) => !used[i] && !STOP.has(w) && !/^\d+$/.test(w) && !NUMW[w] && !/^(герань|реакт|ракет|балист|шахед|бандерол|молни|мгкр|двз|каб)/.test(w));
    if (extra.length > 3) continue;
    if (/(^|\s)(увага|уважно)(\s|$)/.test(text) && !active(t).length) continue;

    const forceNew = /(^|\s)(ще|и ще)\s+(один|одна|1|циль)|(^|\s)(другий|другой|третий|третій|четвертий|инший|иной|новий|новый|нових|новых|нова|нове|новая|новое|вилиз[а-я]*|вылез[а-я]*)(\s|$)/.test(text);
    // Путові точки В ПОРЯДКУ ТЕКСТУ. «на/до/курс/курсом/вектором/у напрямку» — напрямок;
    // «з/із/від + місце» — звідки летить (НЕ путова точка, а підказка курсу вильоту).
    const seqPl = places.map((p) => {
      const prev = toks[p.i - 1] || "", prev2 = toks[p.i - 2] || "";
      const origin = /^(з|із|зі|зи|со|с|от|від|вид|из)$/.test(prev)
        || (prev === "боку" && prev2 === "з")
        || (prev === "стороны" && (prev2 === "со" || prev2 === "с"))
        || ((prev === "напрямку" || prev === "району" || prev === "района") && /^(з|із|из)$/.test(prev2));
      const dir = nre("^(на|до|курс|курсом|вектор|вектором|напрямку|напрям|направлении|направление|сторону|прямує|прямует|направляется|направляється|следует|слідує|рухається|движется|летить|летит|иде|идет)$").test(prev)
        || (prev === "бик" && (prev2 === "в" || prev2 === "у"))
        || (prev === "сторону" && (prev2 === "в" || prev2 === "у"))
        || (prev === "напрямку" && (prev2 === "у" || prev2 === "в"))
        || (prev === "направлении" && prev2 === "в");
      return { ...p, origin, dir };
    });
    const wps = seqPl.filter((p) => !p.origin);
    const originLL = (seqPl.find((p) => p.origin) || {}).ll || null;
    if (!wps.length) continue;
    const first = wps[0];

    // Ракету породжує ЛИШЕ явний репорт про ракету («іскандер», «циркон», «балістична»,
    // «крилата», «калібр»…). Звичайні репорти про точки («Печерськ», «на Оболонь»)
    // завжди лишаються дронами й ніколи не стають ракетами — це прибирає фантомні
    // балістичні цілі, що раніше з’являлися «з нізвідки» після будь-якого згадування ракети.
    if (ty && ty.missile) {
      let tg = null;
      if (!(count > 1) && !forceNew) {
        tg = active(t).filter((x) => !TYPES[x.type].slow && x.type === ty.type && x.arrive + 20000 >= t && dist(posAt(x, t), first.ll) <= 30).sort((a, b) => b.updated - a.updated)[0];
      }
      if (tg) {
        if (ty.speed) tg.spd = ty.speed;
        let ct = t;
        for (const p of wps) { goTo(tg, p.ll, ct, p.name, t); ct = tg.arrive; }
      } else {
        tg = spawn(ty, first.ll, first.name, t, count || 1, originLL, true);
        let ct = tg.arrive;
        for (const p of wps.slice(1)) { goTo(tg, p.ll, ct, p.name, t); ct = tg.arrive; }
      }
      tg.explicitAt = t; tg.explicitLL = first.ll;
      continue;
    }

    /* повільні цілі: шахеди, реактивні, неопізнані.
       Один дрон, який перелітає між точками, — одна ціль: шукаємо найближчу активну
       повільну ціль generous-радіусом (канали часто називають різні сусідні точки й
       різний тип), зіставляючи і поточну позицію, і останню відому точку. */
    let tg = null;
    if (!forceNew && !(count > 1)) {
      // Одна ціль = один дрон: канал часто називає ту саму точку іншим словом або
      // сусідню локацію. Збіг за назвою місця (свіжий репорт) — сильний сигнал дубля.
      const nameHit = (x) => t - x.updated <= 180000 && (x.last === first.name || (x.route || []).includes(first.name));
      // «Тепер вона летит на Позняки» — явне продовження про вже згадану ціль:
      // радіус generous. Позиційна ціль без курсу («Герань-2 в Борисполі») чекає
      // на репорт з курсом — теж generous, інакше замість довороту з'явиться дубль.
      const cont = nre("(^|\\s)(тепер|теперь|уже|вже|вона|він|он|она|вони|они|далі|дальше|потім|потом|знову|снова|повернув|повернула|повернули|розвернувся|развернулся|змінив|сменил|змінює|меняет|перенаправлено|перенаправлена|прямує|прямует|направляется|направляється|следует|слідує|продовжує|продолжает|повертає|поворачивает|розвертається|разворачивается|полетів|полетел|направився|направился|перейшов|перешел)(\\s|$)").test(text);
      // Явний «Герань-2» (моторний) не зливаємо з реактивною ціллю — це різні дрони.
      // Радіус фізичний: 6 км похибки назви + швидкість типу × час від репорту.
      // Дрон не міг пролетіти 13 км за хвилину — отже, це інша ціль, а не продовження.
      tg = active(t).filter((x) => TYPES[x.type].slow && !(ty && ty.type === "shahed" && x.type === "jet"))
        .map((x) => { const cur = posAt(x, t), lp = x.pts[x.pts.length - 1];
          return { x, d: nameHit(x) ? 0 : Math.min(dist(cur, first.ll), dist([lp[0], lp[1]], first.ll)) }; })
        .filter((c) => {
          const spd = c.x.spd || TYPES[c.x.type].speed;
          const generous = c.x.pts.length < 2 || cont;
          return c.d <= Math.min(35, 6 + spd * ((t - c.x.updated) / 1000) + (generous ? 25 : 0));
        })
        .sort((a, b) => a.d - b.d || b.x.updated - a.x.updated)[0]?.x || null;
    }
    if (tg) {
      // узгоджуємо тип: неопізнану уточнюємо, «шахед» підвищуємо до реактивного за репортом
      if (ty && (tg.type === "unknown" || (ty.type === "jet" && tg.type === "shahed"))) { tg.type = ty.type; tg.name = ty.name; tg.spd = ty.speed || TYPES[ty.type].speed; }
      else if (ty && ty.name !== DEFAULT_NAME[ty.type]) tg.name = ty.name;
      let ct = t;
      for (const p of wps) { goTo(tg, p.ll, ct, p.name, t); ct = tg.arrive; }
      if (ty) { tg.explicitAt = t; tg.explicitLL = first.ll; }
    } else {
      const hint = ty || (slowHint && t - slowHint.t <= 30 * 60000 ? slowHint : null) || { type: "unknown", name: DEFAULT_NAME.unknown };
      tg = spawn(hint, first.ll, first.name, t, count || 1, originLL, first.dir);
      let ct = tg.arrive;
      for (const p of wps.slice(1)) { goTo(tg, p.ll, ct, p.name, t); ct = tg.arrive; }
      if (ty) { tg.explicitAt = t; tg.explicitLL = first.ll; }
    }
    if (tg && circling && wps.length) orbit(tg, first.ll, t);
    if (tg && alt) tg.alt = alt;
    if (tg && count > 1) tg.count = count;
  }

  // Ціль не «вмирає» в названій точці: долетівши до неї, вона летить ДАЛІ по
  // встановленому курсу — і дрони, І РАКЕТИ. Продовжуємо останній перегін уздовж
  // його азимуту до горизонту життя типу, поки не прийде новий репорт. «Аби куди»
  // не вигадуємо: лише вздовж відомого курсу. Завдяки цьому ракета не «б'є» по центру
  // названого міста, а пролітає крізь нього й зникає вже в польоті, коли спливе час.
  for (const x of T) {
    if (x.gone || x.pts.length < 2) continue;
    const a = x.pts[x.pts.length - 2], b = x.pts[x.pts.length - 1];
    if (dist([a[0], a[1]], [b[0], b[1]]) < 0.05) continue;
    const br = bearing([a[0], a[1]], [b[0], b[1]]);
    const horizon = TYPES[x.type].slow ? IDLE_SLOW : TYPES[x.type].life * 1000;
    const tEnd = Math.max(b[2], now) + horizon;
    const e = offset([b[0], b[1]], br, (x.spd || TYPES[x.type].speed) * ((tEnd - b[2]) / 1000));
    x.pts.push([e[0], e[1], tEnd]);
    x.arrive = tEnd;
  }

  // Фінальний захист від дублів: якщо два повільні треки одного (або сумісного)
  // типу опинилися надто близько — це один дрон, різні канали/точки. Лишаємо свіжіший.
  // Одинока позиційна точка (репорт «Герань-2 в Борисполі») лишається живою: вона
  // чекає на наступний репорт з курсом і не зникає до завершення idle-горизонту.
  const kept = [];
  for (const x of active(now).sort((a, b) => b.updated - a.updated || b.route.length - a.route.length)) {
    if (TYPES[x.type].slow) {
      const dup = kept.find((k) => TYPES[k.type].slow
        && (k.type === x.type || k.type === "unknown" || x.type === "unknown")
        && dist(posAt(k, now), posAt(x, now)) <= 4);
      if (dup) { x.gone = true; continue; }
    }
    kept.push(x);
  }
  const out = kept.map((x) => ({
    id: x.id, type: x.type, name: x.name, count: x.count, alt: x.alt,
    pts: x.pts.map((p) => [r5(p[0]), r5(p[1]), Math.round(p[2])]),
    last: x.last, dest: x.dest, route: x.route.slice(-6), updated: x.updated,
    speed: x.spd || TYPES[x.type].speed, slow: !!TYPES[x.type].slow,
    ...(opts && opts.withEvidence ? { explicitAt: x.explicitAt || null, explicitLL: x.explicitLL || null } : {}),
  }));
  // внутрішня службова інформація для злиття; у відповідь API не потрапляє
  if (opts && opts.withEvidence) out.evidence = { removals };
  return out;
}