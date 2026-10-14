import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme } from "../../context/ThemeContext";

/**
 * Light, dark, or follow the system.
 *
 * Three buttons rather than a two-state switch, because "follow the system" is
 * a real answer: somebody who works on a light monitor and reads at night does
 * not want to flip this twice a day. The switch would make that impossible —
 * it can only express light or dark, so choosing either silently stops them
 * following their laptop.
 */
const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

export default function ThemeToggle({ className = "" }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`inline-flex items-center gap-0.5 rounded-xl bg-ink-100/70 p-1 ring-1 ring-ink-200/70 dark:bg-ink-100/60 dark:ring-ink-700 ${className}`}
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(option.value)}
            className={`grid size-9 place-items-center rounded-lg transition-all duration-150 ${
              selected
                ? "bg-surface text-brand-700 shadow-card ring-1 ring-ink-200/70 dark:text-brand-300 dark:ring-ink-600"
                : "text-ink-500 hover:text-ink-800 dark:hover:text-ink-200"
            }`}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {/* The label is for a screen reader: the icon alone says nothing. */}
            <span className="sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
