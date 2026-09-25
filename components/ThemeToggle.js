import { useEffect, useState } from "react";

const Sun = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
    <circle cx="10" cy="10" r="3.6" />
    <path d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5" />
  </svg>
);
const Moon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M16.6 12.4A7 7 0 0 1 7.6 3.4a7 7 0 1 0 9 9z" />
  </svg>
);

export default function ThemeToggle() {
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") || "dark");
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#F7F9FC" : "#0F1522");
    try {
      window.localStorage.setItem("ds-theme", next);
    } catch {
      /* the choice just won't be remembered */
    }
    setTheme(next);
  }

  const toLight = theme !== "light";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={toLight ? "Switch to light theme" : "Switch to dark theme"}
      title={toLight ? "Light theme" : "Dark theme"}
    >
      {theme === null ? <span className="theme-toggle-blank" /> : toLight ? <Sun /> : <Moon />}
    </button>
  );
}
