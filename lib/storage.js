// Browser-side persistence for the edited policy.
// Storage can be missing, full, blocked, or hold a config written by an older
// version of the app, so every read is validated and every call is guarded.
import { DEFAULT_CONFIG } from "./defaults.js";
import { configSchema } from "./validate.js";

export const KEY = "ds-config";

export function defaultConfig() {
  return structuredClone(DEFAULT_CONFIG);
}

export function isDefault(config) {
  return JSON.stringify(config) === JSON.stringify(DEFAULT_CONFIG);
}

// Returns { config, source: "defaults" | "custom", notice }
export function loadConfig() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return { config: defaultConfig(), source: "defaults", notice: null };
  }
  if (!raw) return { config: defaultConfig(), source: "defaults", notice: null };
  try {
    const parsed = JSON.parse(raw);
    const ok = configSchema.safeParse(parsed);
    if (ok.success && ok.data.version === DEFAULT_CONFIG.version) {
      return { config: ok.data, source: isDefault(ok.data) ? "defaults" : "custom", notice: null };
    }
  } catch {
    /* fall through */
  }
  clearConfig();
  return {
    config: defaultConfig(),
    source: "defaults",
    notice: "Your saved rules couldn't be read (they may be from an older version of this demo), so they were reset to the defaults.",
  };
}

export function saveConfig(config) {
  try {
    if (isDefault(config)) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

export function clearConfig() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

// Count of settings that differ from the defaults, for the "edited" badge.
export function changeCount(config) {
  let n = 0;
  const walk = (a, b) => {
    if (Array.isArray(a) || (a && typeof a === "object")) {
      const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
      keys.forEach((k) => walk(a?.[k], b?.[k]));
    } else if (a !== b) n++;
  };
  walk(config, DEFAULT_CONFIG);
  return n;
}
