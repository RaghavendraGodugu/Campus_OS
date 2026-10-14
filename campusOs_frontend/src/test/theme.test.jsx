/**
 * The theme.
 *
 * Two things are worth locking down, and neither is about the colour values.
 *
 * **It is applied before React exists.** The class is set by an inline script in
 * index.html. If that ever moves into a React effect, the page paints light and
 * then jumps — and a test cannot see it, because by the time anything is
 * mounted the class is set either way. So the assertion here is on the *script*,
 * not on the rendered result.
 *
 * **Three states, not two.** "System" has to be a real choice. Someone who works
 * on a light monitor and reads at night should not have to set this twice a day,
 * and a two-state switch cannot express "just follow my laptop".
 */

import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ThemeToggle from "../components/layout/ThemeToggle";
import { ThemeProvider, useTheme } from "../context/ThemeContext";

const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  delete document.documentElement.style.colorScheme;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("before first paint", () => {
  it("sets the class from an inline script, not from React", () => {
    // Before the module bundle is even fetched.
    expect(html.indexOf("campusos.theme")).toBeLessThan(
      html.indexOf("/src/main.jsx"),
    );
  });

  it("keeps that script inline, because an external one is another request", () => {
    const inline = html.match(
      /<script>\s*\(function[\s\S]*?campusos\.theme[\s\S]*?<\/script>/,
    );
    expect(inline).not.toBeNull();
  });

  it("tells the browser to render form controls for the chosen theme", () => {
    // Otherwise a dark page gets a white select and a light scrollbar.
    expect(html).toMatch(/color-scheme/);
  });
});

/** A component that exposes the hook so the state machine can be driven. */
function Probe() {
  const { theme, isDark } = useTheme();
  return (
    <p>
      theme={theme} dark={String(isDark)}
    </p>
  );
}

function renderProbe() {
  // Both components share one provider, which is the point: as a plain hook they
  // each held their own state and disagreed.
  return render(
    <ThemeProvider>
      <ThemeToggle />
      <Probe />
    </ThemeProvider>,
  );
}

describe("choosing a theme", () => {
  it("offers light, system and dark", () => {
    renderProbe();

    expect(
      screen.getByRole("radiogroup", { name: /colour theme/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /system/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /dark/i })).toBeInTheDocument();
  });

  it("defaults to following the system, not to light", () => {
    renderProbe();

    expect(screen.getByRole("radio", { name: /system/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("adds the class and remembers the choice", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("radio", { name: /dark/i }));

    expect(document.documentElement).toHaveClass("dark");
    // A reload has to come back dark, or the choice was not saved.
    expect(localStorage.getItem("campusos.theme")).toBe("dark");
  });

  it("removes it again on the way back", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("radio", { name: /dark/i }));
    await user.click(screen.getByRole("radio", { name: /light/i }));

    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("campusos.theme")).toBe("light");
  });

  /**
   * The class alone is not enough: without `color-scheme` the browser renders a
   * native select and scrollbar for the *light* palette over a dark page.
   */
  it("sets color-scheme so native controls match", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("radio", { name: /dark/i }));

    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("is one shared theme, not one per component", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("radio", { name: /dark/i }));

    // Both read the same state; if they each held their own, this would
    // disagree with the probe.
    expect(screen.getByText(/theme=dark/)).toBeInTheDocument();
  });

  it("survives storage being unavailable", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    renderProbe();
    await user.click(screen.getByRole("radio", { name: /dark/i }));

    // Private browsing must still change the theme, just not remember it.
    expect(document.documentElement).toHaveClass("dark");
  });
});

describe("following the system", () => {
  const listeners = [];
  let prefersDark = false;

  beforeEach(() => {
    listeners.length = 0;
    prefersDark = false;
    /*
     * A real removeEventListener, not a no-op.
     *
     * The hook unsubscribes when the theme stops being "system". With a no-op
     * remove, the stale listener survives and re-applies the system preference
     * after an explicit choice — so the test would fail for a reason that does
     * not exist in the product.
     */
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: prefersDark,
      media: query,
      onchange: null,
      addEventListener: (_type, handler) => listeners.push(handler),
      removeEventListener: (_type, handler) => {
        const index = listeners.indexOf(handler);
        if (index !== -1) listeners.splice(index, 1);
      },
      dispatchEvent: () => false,
    }));
  });

  it("follows the preference while set to system", () => {
    renderProbe();

    // The effect runs on mount, so `system` has already been applied.
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("stops following once a choice is made", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("radio", { name: /light/i }));

    // The OS flipping to dark must not override an explicit choice.
    act(() => {
      prefersDark = true;
      [...listeners].forEach((handler) => handler({ matches: true }));
    });

    expect(document.documentElement).not.toHaveClass("dark");
  });
});
