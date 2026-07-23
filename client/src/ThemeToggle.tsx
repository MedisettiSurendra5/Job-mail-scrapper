import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  return (
    <button
      type="button"
      className="btn-secondary btn-small theme-toggle"
      onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? "☀ Light" : "☾ Dark"}
    </button>
  );
}
