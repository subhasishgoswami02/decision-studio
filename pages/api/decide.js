import { decide } from "../../lib/engine";
import { DEFAULT_CONFIG } from "../../lib/defaults";
import { suggestChange } from "../../lib/counterfactual";
import { decideRequestSchema, issueList } from "../../lib/validate";
import { createLimiter, clientKey } from "../../lib/ratelimit";

// The body is read here rather than by Next's parser, so that the rate limit
// runs first and every error (bad JSON, too large, wrong type) comes back as
// the same JSON shape with the same headers.
export const config = {
  api: { bodyParser: false },
};

const MAX_BYTES = 32 * 1024;
const LIMIT = 60;
const limiter = createLimiter({ limit: LIMIT, windowMs: 60_000 });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST with a JSON body." });
  }

  const gate = limiter(clientKey(req));
  res.setHeader("X-RateLimit-Limit", String(LIMIT));
  res.setHeader("X-RateLimit-Remaining", String(gate.remaining));
  if (!gate.allowed) {
    res.setHeader("Retry-After", String(gate.retryAfterSec));
    return res.status(429).json({ error: "Too many requests. Try again in a minute." });
  }

  const type = String(req.headers?.["content-type"] || "");
  if (type && !/^application\/json\b/i.test(type)) {
    return res.status(415).json({ error: "Send the body as application/json." });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    if (e.code === "TOO_LARGE") return res.status(413).json({ error: "Request body is larger than 32 KB." });
    return res.status(400).json({ error: "Request body is not valid JSON." });
  }

  const parsed = decideRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", issues: issueList(parsed.error) });
  }

  try {
    const { applicant, config: cfg } = parsed.data;
    const policy = cfg || DEFAULT_CONFIG;
    const result = decide(applicant, policy);
    const suggestion = suggestChange(applicant, policy, result);
    return res.status(200).json({ ...result, suggestion });
  } catch (e) {
    console.error("decide failed", e);
    return res.status(500).json({ error: "The decision engine hit an unexpected error." });
  }
}

// Reads and parses the request body with a hard size cap.
// If something upstream already parsed it (tests, other runtimes), use that.
async function readJson(req) {
  if (req.body !== undefined) {
    if (typeof req.body !== "string") return req.body;
    if (Buffer.byteLength(req.body) > MAX_BYTES) throw Object.assign(new Error("too large"), { code: "TOO_LARGE" });
    return req.body === "" ? {} : JSON.parse(req.body);
  }
  const declared = Number(req.headers?.["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw Object.assign(new Error("too large"), { code: "TOO_LARGE" });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw Object.assign(new Error("too large"), { code: "TOO_LARGE" });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() === "" ? {} : JSON.parse(text);
}
