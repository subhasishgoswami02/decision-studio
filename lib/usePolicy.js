import { useCallback, useEffect, useState } from "react";
import { loadConfig, saveConfig, clearConfig, defaultConfig, changeCount, KEY } from "./storage";

// Shared view of the active policy for every page.
// Starts as the defaults (matches the server render), then loads any edited
// policy from this browser after mount.
export function usePolicy() {
  const [state, setState] = useState({
    config: defaultConfig(),
    source: "defaults",
    notice: null,
    ready: false,
    saveFailed: false,
  });

  useEffect(() => {
    const loaded = loadConfig();
    setState({ ...loaded, ready: true, saveFailed: false });
    // Keep other open tabs in step when the rules change in one of them.
    const onStorage = (e) => {
      if (e.key !== null && e.key !== KEY) return;
      setState((s) => ({ ...s, ...loadConfig(), ready: true }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((next) => {
    const ok = saveConfig(next);
    setState((s) => ({
      ...s,
      config: next,
      source: changeCount(next) === 0 ? "defaults" : "custom",
      notice: null,
      saveFailed: !ok,
    }));
  }, []);

  const reset = useCallback(() => {
    clearConfig();
    setState((s) => ({ ...s, config: defaultConfig(), source: "defaults", notice: null, saveFailed: false }));
  }, []);

  return { ...state, changes: changeCount(state.config), update, reset };
}
