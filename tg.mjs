const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === "#") { const n = /x/i.test(e[1]) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e] ?? m;
});
const clean = (h) => decode(h.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
  .split("\n").filter((l) => !/Підписатись на Waypoint/i.test(l)).join("\n").trim();
export function parse(html) {
  const out = [];
  for (const p of html.split('class="tgme_widget_message_wrap').slice(1)) {
    const id = p.match(/data-post="[^"/]+\/(\d+)"/), time = p.match(/<time datetime="([^"]+)"/);
    const tm = p.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const text = tm ? clean(tm[1]) : "";
    // Фото допису (в т.ч. альбоми): кожен photo_wrap несе свій CDN-URL у style.
    const photos = [...p.matchAll(/tgme_widget_message_photo_wrap[^>]*?background-image:url\('([^']+)'\)/g)].map((m) => m[1]);
    if (id && time && (text || photos.length)) out.push({ id: +id[1], time: time[1], text, photos });
  }
  return out;
}
export async function page(channel, before) {
  const r = await fetch(`https://t.me/s/${channel}` + (before ? `?before=${before}` : ""), { headers: { "User-Agent": "Mozilla/5.0 (Waypoint)" }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error("telegram " + r.status);
  return parse(await r.text());
}
