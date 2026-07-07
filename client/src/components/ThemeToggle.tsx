import { useTheme } from "../theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const switchToLabel = theme === "dark" ? "light" : "dark";

  return (
    <button className="theme-toggle" onClick={toggle} title={`Switch to ${switchToLabel} mode`} aria-label={`Switch to ${switchToLabel} mode`}>
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
