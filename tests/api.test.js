// POST /api/decide, exercised through the handler with mock req/res objects.
// Also covers INVARIANTS item 8 ("The API rejects malformed applications and
// rule sets with a 400, never a crash"); items 1 to 7 live in
// tests/invariants.test.js.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Readable } from "node:stream";
import handler from "../pages/api/decide.js";
import { DEFAULT_CONFIG } from "../lib/defaults.js";
import { scenarioById, SCENARIOS } from "../lib/scenarios.js";
import { clientKey, createLimiter } from "../lib/ratelimit.js";
import { makeRng, clone } from "./helpers/random.js";

// The limiter is module-level state shared by every test in this file, so
// each request gets its own address unless a test is about rate limiting.
let ipCounter = 0;
const freshIp = () => {
  ipCounter++;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(n) {
      this.statusCode = n;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

// Pre-parsed path: req.body is already set (an object, or a string that the
// handler parses). Pass `raw` instead to send bytes through the stream path.
async function call({ method = "POST", body, raw, ip = freshIp(), headers = {} } = {}) {
  const allHeaders = { "x-forwarded-for": ip, ...headers };
  let req;
  if (raw !== undefined) {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    req = Object.assign(Readable.from(buf.length ? [buf] : []), { method, headers: allHeaders, socket: { remoteAddress: "127.0.0.1" } });
  } else if (body === undefined) {
    req = Object.assign(Readable.from([]), { method, headers: allHeaders, socket: { remoteAddress: "127.0.0.1" } });
  } else {
    req = { method, body, headers: allHeaders, socket: { remoteAddress: "127.0.0.1" } };
  }
  const res = mockRes();
  await handler(req, res);
  return res;
}

function expectSafeHeaders(res) {
  expect(res.headers["cache-control"]).toBe("no-store");
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
}

function expectNoLeak(res) {
  const text = JSON.stringify(res.body);
  expect(text).not.toMatch(/\bat .+\.(m?js|ts):\d+/);
  expect(text).not.toMatch(/stack|ZodError|SyntaxError|node_modules|Unexpected token/i);
}

const thinFile = scenarioById("thin-file").applicant;

function expectCleanIssues(res) {
  expect(res.statusCode).toBe(400);
  expect(res.body.error).toBe("Invalid request");
  expect(Array.isArray(res.body.issues)).toBe(true);
  expect(res.body.issues.length).toBeGreaterThan(0);
  expect(res.body.issues.length).toBeLessThanOrEqual(10);
  for (const issue of res.body.issues) {
    expect(Object.keys(issue).sort()).toEqual(["message", "path"]);
    expect(typeof issue.path).toBe("string");
    expect(typeof issue.message).toBe("string");
  }
  expectNoLeak(res);
  expectSafeHeaders(res);
}

const issuePaths = (res) => res.body.issues.map((i) => i.path);

describe("method and headers", () => {
  it.each(["GET", "PUT", "DELETE", "PATCH"])("%s gets 405 with Allow: POST", async (method) => {
    const res = await call({ method });
    expect(res.statusCode).toBe(405);
    expect(res.headers["allow"]).toBe("POST");
    expect(res.body.error).toBeTruthy();
    expectSafeHeaders(res);
  });

  it("sets Cache-Control: no-store and nosniff on every response", async () => {
    expectSafeHeaders(await call({ method: "GET" }));
    expectSafeHeaders(await call({ body: { applicant: thinFile } }));
    expectSafeHeaders(await call({ body: {} }));
    expectSafeHeaders(await call({ raw: "{nope" }));
    expectSafeHeaders(await call({ raw: "{}", headers: { "content-type": "text/plain" } }));
    expectSafeHeaders(await call({ raw: "{}", headers: { "content-length": "40000" } }));
  });
});

describe("valid requests", () => {
  it("decides a scenario applicant with the default policy when no config is sent", async () => {
    const res = await call({ body: { applicant: thinFile } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("decision", "APPROVED");
    expect(res.body).toHaveProperty("trace");
    expect(Array.isArray(res.body.trace)).toBe(true);
    expect(res.body).toHaveProperty("suggestion", null);
    expect(res.body).toHaveProperty("unroutable", false);
    expect(res.body.score).toBe(79.4);
    expect(res.body.pricing.band).toBe("B");
  });

  it("returns a suggestion for a non-approved applicant", async () => {
    const res = await call({ body: { applicant: scenarioById("borderline-review").applicant } });
    expect(res.statusCode).toBe(200);
    expect(res.body.decision).toBe("REVIEW");
    expect(res.body.suggestion).toMatchObject({ kind: "amount", amount: 14000 });
  });

  it("honors a custom valid config: approveAt 90 turns the thin file into REVIEW", async () => {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.decisionThresholds.approveAt = 90;
    const res = await call({ body: { applicant: thinFile, config: cfg } });
    expect(res.statusCode).toBe(200);
    expect(res.body.decision).toBe("REVIEW");
    expect(res.body.score).toBe(79.4);
  });

  it("gives every golden scenario the same decision as the engine", async () => {
    for (const s of SCENARIOS) {
      const res = await call({ body: { applicant: s.applicant } });
      expect(res.statusCode, s.id).toBe(200);
      expect(res.body.decision, s.id).toBe(s.expect.decision);
    }
  });

  it("parses a JSON string body that was already read upstream", async () => {
    const res = await call({ body: JSON.stringify({ applicant: thinFile }) });
    expect(res.statusCode).toBe(200);
    expect(res.body.decision).toBe("APPROVED");
  });
});

describe("stream path: the handler reads the body itself", () => {
  const json = JSON.stringify({ applicant: thinFile });

  it("valid JSON gets 200", async () => {
    const res = await call({ raw: json, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.decision).toBe("APPROVED");
    expect(res.body.score).toBe(79.4);
  });

  it("accepts application/json with a charset, and no content-type at all", async () => {
    expect((await call({ raw: json, headers: { "content-type": "application/json; charset=utf-8" } })).statusCode).toBe(200);
    expect((await call({ raw: json })).statusCode).toBe(200);
  });

  it("a body split across many chunks is reassembled", async () => {
    const buf = Buffer.from(json);
    const chunks = [];
    for (let i = 0; i < buf.length; i += 7) chunks.push(buf.subarray(i, i + 7));
    const req = Object.assign(Readable.from(chunks), {
      method: "POST",
      headers: { "x-forwarded-for": freshIp(), "content-type": "application/json" },
    });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ["truncated JSON", '{"applicant": {'],
    ["not JSON at all", "applicant=1"],
    ["single quotes", "{'applicant': 1}"],
  ])("invalid JSON (%s) gets 400 with a plain message", async (_n, raw) => {
    const res = await call({ raw, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Request body is not valid JSON." });
    expectSafeHeaders(res);
  });

  it("an empty stream is treated as {} and fails validation with issues", async () => {
    const res = await call({ raw: "" });
    expectCleanIssues(res);
    expect(issuePaths(res)).toContain("applicant");
  });

  it("an oversized streamed body gets 413", async () => {
    const big = JSON.stringify({ applicant: thinFile, pad: "x".repeat(33 * 1024) });
    const res = await call({ raw: big, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: "Request body is larger than 32 KB." });
    expectSafeHeaders(res);
  });

  it("a body of exactly 32768 bytes is not rejected for size", async () => {
    const base = JSON.stringify({ applicant: thinFile, pad: "" });
    const exact = base.replace('"pad":""', `"pad":"${"x".repeat(32768 - base.length)}"`);
    expect(Buffer.byteLength(exact)).toBe(32768);
    const res = await call({ raw: exact });
    // Not 413: the unknown "pad" key makes it a validation 400 instead.
    expect(res.statusCode).toBe(400);
    expect(issuePaths(res)).toContain("");
  });

  it("a declared content-length over 32 KB gets 413 without reading the body", async () => {
    const res = await call({ raw: json, headers: { "content-length": "32769" } });
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: "Request body is larger than 32 KB." });
  });

  it("an oversized pre-read string body gets 413", async () => {
    const res = await call({ body: "x".repeat(32769) });
    expect(res.statusCode).toBe(413);
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"])(
    "content-type %s gets 415",
    async (type) => {
      const res = await call({ raw: json, headers: { "content-type": type } });
      expect(res.statusCode).toBe(415);
      expect(res.body.error).toBeTruthy();
      expectNoLeak(res);
      expectSafeHeaders(res);
    }
  );
});

describe("400 for malformed requests", () => {
  const withApplicant = (patch) => ({ applicant: { ...thinFile, ...patch } });
  const withConfig = (mutate) => {
    const cfg = clone(DEFAULT_CONFIG);
    mutate(cfg);
    return { applicant: thinFile, config: cfg };
  };

  const cases = [
    ["missing applicant", {}, "applicant"],
    ["empty loanAmount string", withApplicant({ loanAmount: "" }), "applicant.loanAmount"],
    ["blank loanAmount string", withApplicant({ loanAmount: "   " }), "applicant.loanAmount"],
    ["hex loanAmount", withApplicant({ loanAmount: "0x12" }), "applicant.loanAmount"],
    ["negative loan amount", withApplicant({ loanAmount: -500 }), "applicant.loanAmount"],
    ["unknown extra key on applicant", withApplicant({ ssn: "123" }), "applicant"],
    [
      "weights that do not sum to 100",
      withConfig((c) => (c.scorecard.weights.schoolTier = 30)),
      "config.scorecard.weights",
    ],
    [
      "reviewAt above approveAt",
      withConfig((c) => (c.decisionThresholds = { approveAt: 60, reviewAt: 70 })),
      "config.decisionThresholds.reviewAt",
    ],
    [
      "minAmount above maxAmount",
      withConfig((c) => (c.eligibilityRules[0].params = { minAmount: 90000, maxAmount: 10000 })),
      "config.eligibilityRules.0.params.minAmount",
    ],
    ["unknown rule id", withConfig((c) => (c.eligibilityRules[2].id = "credit-bureau")), "config.eligibilityRules.2.id"],
    [
      "duplicate rule id",
      withConfig((c) => c.eligibilityRules.push(clone(c.eligibilityRules[0]))),
      "config.eligibilityRules",
    ],
    [
      "APR rising for a better band",
      withConfig((c) => (c.pricingTiers[0].apr = 20)),
      "config.pricingTiers.0.apr",
    ],
    ["extra top-level key", { applicant: thinFile, debug: true }, ""],
  ];

  it.each(cases)("%s", async (_name, body, path) => {
    const res = await call({ body });
    expectCleanIssues(res);
    expect(issuePaths(res)).toContain(path);
  });

  it("null, empty, array and non-JSON bodies are 400s, not 500s", async () => {
    expectCleanIssues(await call({ body: null }));
    expectCleanIssues(await call({ body: "" }));
    expectCleanIssues(await call({ body: [] }));
    expectCleanIssues(await call({ body: 42 }));
    const notJson = await call({ body: "applicant" });
    expect(notJson.statusCode).toBe(400);
    expect(notJson.body).toEqual({ error: "Request body is not valid JSON." });
  });
});

describe("fuzz: malformed bodies never produce a 500", () => {
  const rng = makeRng(424242);
  const { int, pick, r } = rng;

  const JUNK = () =>
    pick([
      () => null,
      () => undefined,
      () => "",
      () => "   ",
      () => "abc",
      () => "1e400",
      () => "1e3",
      () => "0x12",
      () => "NaN",
      () => "Infinity",
      () => -1,
      () => 1e308,
      () => -1e308,
      () => Number.MAX_SAFE_INTEGER * 1000,
      () => NaN,
      () => Infinity,
      () => 0.5,
      () => true,
      () => [],
      () => [1, "2", null],
      () => ({}),
      () => ({ nested: { deeper: [{ junk: true }] } }),
      () => "x".repeat(5000),
      () => "__proto__",
      () => ({ __proto__: { polluted: true } }),
      () => ({ toString: "not a function" }),
    ])();

  function mutate(target, depth = 0) {
    if (target === null || typeof target !== "object") return JUNK();
    const keys = Object.keys(target);
    const n = int(1, 3);
    for (let i = 0; i < n; i++) {
      const roll = r();
      if (roll < 0.15) {
        target[`extra${int(0, 99)}`] = JUNK();
      } else if (roll < 0.25 && keys.length) {
        delete target[pick(keys)];
      } else if (keys.length) {
        const k = pick(keys);
        const v = target[k];
        target[k] = v && typeof v === "object" && depth < 4 && r() < 0.6 ? mutate(v, depth + 1) : JUNK();
      }
    }
    return target;
  }

  function malformedBody() {
    const roll = r();
    if (roll < 0.1) return JUNK();
    const body = { applicant: clone(pick(SCENARIOS).applicant) };
    if (roll < 0.5) {
      body.applicant = mutate(body.applicant);
    } else if (roll < 0.9) {
      body.config = mutate(clone(DEFAULT_CONFIG));
    } else {
      body.applicant = mutate(body.applicant);
      body.config = mutate(clone(DEFAULT_CONFIG));
    }
    return body;
  }

  // Byte-level junk for the stream path: truncations and corruptions of a
  // valid request, plus random bytes.
  function malformedRaw() {
    const valid = JSON.stringify({ applicant: pick(SCENARIOS).applicant });
    const roll = r();
    if (roll < 0.3) return valid.slice(0, int(0, valid.length - 1));
    if (roll < 0.6) {
      const i = int(0, valid.length - 1);
      return valid.slice(0, i) + pick(['"', "{", "}", ",", ":", "\\", "\u0000", "]"]) + valid.slice(i + 1);
    }
    if (roll < 0.8) return Buffer.from(Array.from({ length: int(1, 200) }, () => int(0, 255)));
    return JSON.stringify(malformedBody()) ?? "";
  }

  it("300 random malformed object bodies all get 200 or 400", async () => {
    const counts = { 200: 0, 400: 0 };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (let i = 0; i < 300; i++) {
        const body = malformedBody();
        const res = await call({ body });
        expect([200, 400], `body ${i}: ${JSON.stringify(body)?.slice(0, 300)}`).toContain(res.statusCode);
        counts[res.statusCode]++;
        expectNoLeak(res);
        expectSafeHeaders(res);
      }
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
    // Most bodies should be rejected; a few mutations can land on valid values.
    expect(counts[400]).toBeGreaterThan(200);
  });

  it("300 random malformed byte streams all get 200 or 400", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (let i = 0; i < 300; i++) {
        const raw = malformedRaw();
        const res = await call({ raw, headers: { "content-type": "application/json" } });
        expect([200, 400], `raw ${i}: ${String(raw).slice(0, 200)}`).toContain(res.statusCode);
        expectNoLeak(res);
      }
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("rate limit: 60 requests per minute per client", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T10:00:00Z"));
  });
  afterAll(() => vi.useRealTimers());

  it("allows 60, rejects the 61st with Retry-After, and keeps other clients unaffected", async () => {
    const ip = "1.1.1.1";
    for (let i = 1; i <= 60; i++) {
      const res = await call({ body: { applicant: thinFile }, ip });
      expect(res.statusCode, `request ${i}`).toBe(200);
      expect(res.headers["x-ratelimit-remaining"]).toBe(String(60 - i));
    }
    const blocked = await call({ body: { applicant: thinFile }, ip });
    expect(blocked.statusCode).toBe(429);
    const retry = Number(blocked.headers["retry-after"]);
    expect(Number.isInteger(retry)).toBe(true);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
    expect(blocked.body.error).toBeTruthy();
    expectSafeHeaders(blocked);

    const other = await call({ body: { applicant: thinFile }, ip: "2.2.2.2" });
    expect(other.statusCode).toBe(200);

    // The first address from a comma-separated x-forwarded-for is the key.
    const chained = await call({ body: { applicant: thinFile }, ip: "1.1.1.1, 9.9.9.9" });
    expect(chained.statusCode).toBe(429);

    // A new window opens after a minute.
    vi.setSystemTime(new Date("2026-09-25T10:01:00Z"));
    expect((await call({ body: { applicant: thinFile }, ip })).statusCode).toBe(200);
  });

  it("counts invalid requests too, since the limit runs before body parsing", async () => {
    const ip = "3.3.3.3";
    for (let i = 0; i < 20; i++) expect((await call({ body: {}, ip })).statusCode).toBe(400);
    for (let i = 0; i < 20; i++) expect((await call({ raw: "{bad", ip })).statusCode).toBe(400);
    for (let i = 0; i < 20; i++) {
      expect((await call({ raw: "{}", ip, headers: { "content-type": "text/plain" } })).statusCode).toBe(415);
    }
    expect((await call({ body: { applicant: thinFile }, ip })).statusCode).toBe(429);
    // A blocked client gets 429 even for an oversized body, before it is read.
    expect((await call({ raw: "{}", ip, headers: { "content-length": "999999" } })).statusCode).toBe(429);
  });
});

describe("clientKey precedence", () => {
  const req = (headers, remoteAddress = "192.0.2.1") => ({ headers, socket: { remoteAddress } });

  it("prefers x-vercel-forwarded-for, then x-real-ip, then the first x-forwarded-for, then the socket", () => {
    const all = {
      "x-vercel-forwarded-for": "203.0.113.1, 10.0.0.1",
      "x-real-ip": "203.0.113.2",
      "x-forwarded-for": "203.0.113.3, 203.0.113.4",
    };
    expect(clientKey(req(all))).toBe("203.0.113.1");
    const { "x-vercel-forwarded-for": _v, ...noVercel } = all;
    expect(clientKey(req(noVercel))).toBe("203.0.113.2");
    const { "x-real-ip": _r, ...fwdOnly } = noVercel;
    expect(clientKey(req(fwdOnly))).toBe("203.0.113.3");
    expect(clientKey(req({}))).toBe("192.0.2.1");
    expect(clientKey({ headers: {} })).toBe("unknown");
    expect(clientKey({})).toBe("unknown");
  });

  it("trims spaces, reads array headers and skips empty values", () => {
    expect(clientKey(req({ "x-forwarded-for": "  198.51.100.7 , 10.0.0.1" }))).toBe("198.51.100.7");
    expect(clientKey(req({ "x-real-ip": ["198.51.100.8", "x"] }))).toBe("198.51.100.8");
    expect(clientKey(req({ "x-vercel-forwarded-for": "", "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  it("rotating a spoofed x-forwarded-for does not escape the limit when the platform header is set", async () => {
    const platform = { "x-vercel-forwarded-for": "7.7.7.7" };
    for (let i = 0; i < 60; i++) {
      expect((await call({ body: {}, ip: freshIp(), headers: platform })).statusCode).toBe(400);
    }
    const res = await call({ body: { applicant: thinFile }, ip: freshIp(), headers: platform });
    expect(res.statusCode).toBe(429);
  });
});

describe("createLimiter", () => {
  it("resets per window and evicts the oldest key when full", () => {
    const check = createLimiter({ limit: 2, windowMs: 1000, maxKeys: 2 });
    expect(check("a", 0).allowed).toBe(true);
    expect(check("a", 10).allowed).toBe(true);
    const third = check("a", 20);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSec).toBe(1);
    expect(check("a", 1000).allowed).toBe(true);
    check("b", 1000);
    check("c", 1001); // evicts "a", the oldest key
    expect(check("a", 1002).remaining).toBe(1);
  });
});
