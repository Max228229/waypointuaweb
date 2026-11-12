export function sendJson(res, status, body, cache) {
  res.statusCode = status;
  if (cache) {
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.setHeader("Vercel-CDN-Cache-Control", `public, s-maxage=${cache[0]}, stale-while-revalidate=${cache[1]}`);
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
