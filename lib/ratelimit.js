// Fixed-window request limiter, per client key, held in memory.
// On serverless this is per warm instance, so it is a speed bump against a
// runaway script rather than a hard quota. The engine is cheap and pure, so
// that is the right amount of protection for a public demo.
export function createLimiter({ limit, windowMs, maxKeys = 5000 }) {
  const hits = new Map();
  return function check(key, now = Date.now()) {
    let entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      if (!entry && hits.size >= maxKeys) {
        // Drop expired windows; if still full, drop the oldest key.
        for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
      }
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;
    const allowed = entry.count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSec: allowed ? 0 : Math.ceil((entry.start + windowMs - now) / 1000),
    };
  };
}

// Prefer headers the hosting platform sets and a client cannot forge
// (Vercel sets x-real-ip and x-vercel-forwarded-for). Fall back to the first
// X-Forwarded-For entry, then the socket address.
export function clientKey(req) {
  const h = req.headers || {};
  const first = (v) => (Array.isArray(v) ? v[0] : typeof v === "string" ? v.split(",")[0] : "");
  return (
    first(h["x-vercel-forwarded-for"]) ||
    first(h["x-real-ip"]) ||
    first(h["x-forwarded-for"]) ||
    req.socket?.remoteAddress ||
    "unknown"
  ).trim();
}
