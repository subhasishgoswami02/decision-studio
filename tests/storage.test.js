// Browser persistence of the edited policy, with a stubbed localStorage.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { loadConfig, saveConfig, clearConfig, isDefault, changeCount, defaultConfig } from "../lib/storage.js";
import { DEFAULT_CONFIG } from "../lib/defaults.js";
import { clone } from "./helpers/random.js";

const KEY = "ds-config";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
  };
}

function throwingStorage() {
  const boom = () => {
    throw new Error("SecurityError: storage is blocked");
  };
  return { getItem: boom, setItem: boom, removeItem: boom, clear: boom };
}

const hadWindow = "window" in globalThis;
const originalWindow = globalThis.window;

beforeEach(() => {
  globalThis.window = { localStorage: memoryStorage() };
});

afterAll(() => {
  if (hadWindow) globalThis.window = originalWindow;
  else delete globalThis.window;
});

function edited() {
  const c = clone(DEFAULT_CONFIG);
  c.decisionThresholds.approveAt = 70;
  return c;
}

describe("loadConfig", () => {
  it("returns the defaults when nothing is saved", () => {
    const out = loadConfig();
    expect(out).toEqual({ config: DEFAULT_CONFIG, source: "defaults", notice: null });
    expect(out.config).not.toBe(DEFAULT_CONFIG);
  });

  it("returns a valid edited config as custom", () => {
    window.localStorage.setItem(KEY, JSON.stringify(edited()));
    const out = loadConfig();
    expect(out.source).toBe("custom");
    expect(out.notice).toBeNull();
    expect(out.config.decisionThresholds.approveAt).toBe(70);
  });

  it("treats a saved copy of the defaults as defaults", () => {
    window.localStorage.setItem(KEY, JSON.stringify(DEFAULT_CONFIG));
    expect(loadConfig().source).toBe("defaults");
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["a config from another version", JSON.stringify({ ...edited(), version: "1.0" })],
    ["a config saved by the previous 2.0 release", JSON.stringify({ ...edited(), version: "2.0" })],
    ["a config that fails the schema", JSON.stringify({ ...edited(), extra: true })],
    ["JSON null", "null"],
  ])("resets and returns a notice for %s", (_n, raw) => {
    window.localStorage.setItem(KEY, raw);
    const out = loadConfig();
    expect(out.config).toEqual(DEFAULT_CONFIG);
    expect(out.source).toBe("defaults");
    expect(typeof out.notice).toBe("string");
    expect(out.notice.length).toBeGreaterThan(0);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("does not throw when storage is blocked", () => {
    globalThis.window = { localStorage: throwingStorage() };
    expect(() => loadConfig()).not.toThrow();
    expect(loadConfig()).toEqual({ config: DEFAULT_CONFIG, source: "defaults", notice: null });
  });

  it("does not throw when window.localStorage itself throws on access", () => {
    globalThis.window = {
      get localStorage() {
        throw new Error("SecurityError");
      },
    };
    expect(() => loadConfig()).not.toThrow();
    expect(saveConfig(edited())).toBe(false);
    expect(() => clearConfig()).not.toThrow();
  });
});

describe("saveConfig and clearConfig", () => {
  it("stores an edited config and reads it back", () => {
    expect(saveConfig(edited())).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(KEY))).toEqual(edited());
  });

  it("removes the key when the config equals the defaults", () => {
    saveConfig(edited());
    expect(saveConfig(clone(DEFAULT_CONFIG))).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("returns false instead of throwing when storage throws", () => {
    globalThis.window = { localStorage: throwingStorage() };
    expect(() => saveConfig(edited())).not.toThrow();
    expect(saveConfig(edited())).toBe(false);
    expect(saveConfig(clone(DEFAULT_CONFIG))).toBe(false);
    expect(() => clearConfig()).not.toThrow();
  });

  it("clearConfig removes a saved config", () => {
    saveConfig(edited());
    clearConfig();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe("isDefault, defaultConfig and changeCount", () => {
  it("defaultConfig is an independent deep copy", () => {
    const c = defaultConfig();
    expect(c).toEqual(DEFAULT_CONFIG);
    c.eligibilityRules[0].enabled = false;
    expect(DEFAULT_CONFIG.eligibilityRules[0].enabled).toBe(true);
  });

  it("isDefault", () => {
    expect(isDefault(clone(DEFAULT_CONFIG))).toBe(true);
    expect(isDefault(edited())).toBe(false);
  });

  it("counts changed leaves", () => {
    expect(changeCount(clone(DEFAULT_CONFIG))).toBe(0);
    expect(changeCount(edited())).toBe(1);

    const c = edited();
    c.eligibilityRules.find((r) => r.id === "graduate-only").enabled = true;
    c.scorecard.weights.schoolTier = 20;
    c.scorecard.weights.countryRisk = 15;
    expect(changeCount(c)).toBe(4);

    const added = clone(DEFAULT_CONFIG);
    added.eligibilityRules.find((r) => r.id === "supported-destination").params.destinations.push("GB");
    expect(changeCount(added)).toBe(1);
  });
});
