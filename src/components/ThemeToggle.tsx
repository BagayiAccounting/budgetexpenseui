"use client";

import { useEffect, useMemo, useState } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "theme";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      applyTheme(saved);
      return;
    }

    // Default to dark if nothing saved.
    applyTheme("dark");
  }, []);

  const label = useMemo(() => (theme === "dark" ? "Dark" : "Light"), [theme]);

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => {
        const next: Theme = theme === "dark" ? "light" : "dark";
        setTheme(next);
        window.localStorage.setItem(STORAGE_KEY, next);
        applyTheme(next);
      }}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      <span className="theme-toggle-label">Theme</span>
      <span className="theme-toggle-chip">{label}</span>
    </button>
  );
}
