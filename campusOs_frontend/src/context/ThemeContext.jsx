import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * Light / dark theme.
 *
 * ## Applied before first paint, deliberately
 *
 * Reading the stored theme in React would flash the wrong one: the document
 * paints with no `.dark` class, then the effect runs and the page jumps. The
 * inline script in index.html sets the class from `localStorage` *before* the
 * bundle loads, so there is nothing to flash. This hook exists only to reflect
 * and change that choice afterwards.
 *
 * ## Three states, not two
 *
 * System / light / dark. "System" is a real answer here — somebody who uses a
 * light desktop all day and a dark laptop at night should not have to set this
 * by hand twice a day. Following the OS means listening for the preference
 * changing while the app is open, which is why there is a listener rather than a
 * one-time read.
 */

const STORAGE_KEY = "campusos.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStored() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Private browsing, or storage disabled. "System" still works.
    return "system";
  }
}

function systemPrefersDark() {
  return (
    typeof window !== "undefined" && window.matchMedia?.(DARK_QUERY).matches
  );
}

function apply(theme) {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  // Lets the browser render form controls and scrollbars to match.
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

const ThemeContext = createContext(null);

/**
 * Holds the theme once, for the whole app.
 *
 * This began as a plain hook, which looked fine and was not: two components
 * calling it each had their *own* state and their own subscription to the OS
 * preference. The toggle would be set to light while another component still
 * believed the theme was "system" and kept re-applying the OS preference on
 * every change — so the two disagreed and the last writer won.
 */
export function ThemeProvider({ children }) {
  const value = useThemeState();

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** Fails loudly rather than silently returning a default with no effect. */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return context;
}

function useThemeState() {
  const [theme, setTheme] = useState(readStored);

  // Keep the document in step with the stored choice, and follow the OS while
  // the choice is "system".
  useEffect(() => {
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Nothing to do; the theme still applies for this session.
    }

    if (theme !== "system") return undefined;

    const query = window.matchMedia(DARK_QUERY);
    /*
     * The handler is kept in a variable.
     *
     * `removeEventListener("change", () => apply("system"))` passes a *different*
     * arrow function to the one that was added, so it removes nothing and the
     * listener leaks. In the app that means the old "system" listener keeps
     * re-applying the OS preference after somebody has chosen light or dark
     * explicitly — their choice silently loses the next time they switch
     * monitors.
     */
    const onChange = () => apply("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  // Kept in state only so the icon reflects what the OS is doing right now.
  const [isDark, setIsDark] = useState(systemPrefersDark);
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setIsDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme(isDark ? "light" : "dark");
  }, [isDark]);

  return { theme, setTheme, isDark, toggle };
}
