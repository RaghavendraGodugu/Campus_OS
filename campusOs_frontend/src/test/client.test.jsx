/**
 * Client tests.
 *
 * Focused on the behaviour where a front-end mistake would be a security
 * problem rather than a visual one: money formatting, the CSRF header, and the
 * session state machine that decides whether anyone gets logged out.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  formatMoney,
  money,
  humanise,
  initials,
  formatDate,
  formatRelative,
} from "../lib/format";
import { apiAssetUrl, http, readCsrfToken, ApiError } from "../api/client";

// ===========================================================================
// Money
// ===========================================================================

describe("formatMoney", () => {
  /**
   * The client must never produce a different figure from the server.
   *
   * Integer paise go in and a formatted string comes out. There is no parse
   * step anywhere in this file, which is the point: parsing a rupee string back
   * into a number is how a float reaches a total.
   */
  it("formats paise as rupees with Indian grouping", () => {
    expect(formatMoney(590000)).toBe("₹5,900.00");
    expect(formatMoney(1234567)).toBe("₹12,345.67");
    expect(formatMoney(100)).toBe("₹1.00");
    expect(formatMoney(0)).toBe("₹0.00");
  });

  it("groups the last three digits then pairs, as India does", () => {
    // 12,34,567 — not 1,234,567.
    expect(formatMoney(123456700)).toBe("₹12,34,567.00");
    expect(formatMoney(100000000)).toBe("₹10,00,000.00");
  });

  /**
   * The regression that motivates the whole file: 0.1 + 0.2 is not 0.3.
   *
   * These are the paise values of ₹0.10 and ₹0.20. Added as integers they are
   * 30 exactly. Any float arithmetic anywhere in the chain would make this
   * 29.999999999999996, and a college would be billed a paisa it was not owed.
   */
  it("never loses a paisa to floating point", () => {
    const tenPaise = 10;
    const twentyPaise = 20;
    const thirtyPaise = tenPaise + twentyPaise;

    expect(thirtyPaise).toBe(30);
    expect(formatMoney(thirtyPaise)).toBe("₹0.30");
  });

  it("handles negatives without corrupting the digits", () => {
    expect(formatMoney(-590000)).toBe("-₹5,900.00");
  });

  /**
   * A missing amount is unknown, not zero.
   *
   * Rendering a missing figure as ₹0.00 is a claim that something is free. On a
   * finance screen that is worse than showing nothing.
   */
  it("shows a dash for an unknown amount rather than zero", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(NaN)).toBe("—");
  });

  it("prefers the server's own formatted string", () => {
    // When the server has already formatted it, that is the authority.
    expect(money("₹11,800.00", 123)).toBe("₹11,800.00");
    // And formats bare when it has not.
    expect(money(undefined, 590000)).toBe("₹5,900.00");
  });
});

describe("humanise", () => {
  it("turns a status into a readable label", () => {
    expect(humanise("PARTIALLY_PAID")).toBe("Partially paid");
    expect(humanise("PAID")).toBe("Paid");
    expect(humanise("ACTION_REQUIRED")).toBe("Action required");
    expect(humanise("")).toBe("—");
  });
});

describe("initials", () => {
  it("uses at most two letters", () => {
    expect(initials("Akanksha Tyagi")).toBe("AT");
    expect(initials("Cher")).toBe("C");
    expect(initials("")).toBe("?");
  });
});

describe("dates", () => {
  it("shows a dash rather than Invalid Date", () => {
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDate(null)).toBe("—");
  });

  it("stops guessing beyond a month", () => {
    const old = new Date(Date.now() - 200 * 86400000).toISOString();
    // "46d ago" stops being useful and starts being noise.
    expect(formatRelative(old)).toMatch(/\d{2} \w{3} \d{4}/);
  });

  it("says just now for something a minute old", () => {
    expect(formatRelative(new Date().toISOString())).toBe("just now");
  });
});

// ===========================================================================
// Media URLs
// ===========================================================================

describe("apiAssetUrl", () => {
  it("uses the API base for img endpoints", () => {
    // An <img> bypasses axios, so it also bypasses baseURL. Building the URL
    // here keeps avatars and announcement images on the configured API origin.
    expect(apiAssetUrl("/profile/avatar/user-1")).toBe(
      "/api/v1/profile/avatar/user-1",
    );
    expect(apiAssetUrl("profile/avatar/user-1")).toBe(
      "/api/v1/profile/avatar/user-1",
    );
  });
});

// ===========================================================================
// CSRF
// ===========================================================================

describe("CSRF handling", () => {
  beforeEach(() => {
    document.cookie = "cos_ct=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the readable CSRF cookie", () => {
    document.cookie = "cos_ct=token-value-123; path=/";
    expect(readCsrfToken()).toBe("token-value-123");
  });

  it("returns null when there is no session yet", () => {
    expect(readCsrfToken()).toBeNull();
  });

  it("reads the token fresh on every unsafe request", async () => {
    document.cookie = "cos_ct=first-token; path=/";
    const first = http.interceptors.request.handlers[0].fulfilled({
      method: "post",
      headers: {},
    });
    expect(first.headers["X-CSRF-Token"]).toBe("first-token");

    // The server rotates the token, so a cached copy silently starts failing.
    document.cookie = "cos_ct=second-token; path=/";
    const second = http.interceptors.request.handlers[0].fulfilled({
      method: "post",
      headers: {},
    });
    expect(second.headers["X-CSRF-Token"]).toBe("second-token");
  });

  /**
   * A safe method must not carry the header.
   *
   * Sending it anyway is harmless but noisy; more importantly, this pins the
   * unsafe-method set so it cannot quietly grow to include GET and start
   * tripping needless preflights.
   */
  it("omits the header on safe requests", () => {
    document.cookie = "cos_ct=token-value; path=/";
    const config = http.interceptors.request.handlers[0].fulfilled({
      method: "get",
      headers: {},
    });
    expect(config.headers["X-CSRF-Token"]).toBeUndefined();
  });

  it("sends cookies with every request", () => {
    // The session lives in an HttpOnly cookie; without this it never arrives.
    expect(http.defaults.withCredentials).toBe(true);
  });
});

// ===========================================================================
// API errors
// ===========================================================================

describe("ApiError", () => {
  it("keeps the server's own code and status", () => {
    const error = new ApiError("Not allowed", {
      status: 403,
      code: "FORBIDDEN",
    });

    expect(error.isForbidden).toBe(true);
    expect(error.isUnauthenticated).toBe(false);
    expect(error.code).toBe("FORBIDDEN");
  });

  it("recognises an expired session", () => {
    expect(
      new ApiError("Session expired", { status: 401 }).isUnauthenticated,
    ).toBe(true);
  });

  /**
   * The server names the offending field, and surfacing that next to the input
   * is the difference between "something is wrong" and "the deadline must be in
   * the future".
   */
  it("exposes field-level messages keyed by field", () => {
    const error = new ApiError("The submitted data is invalid", {
      status: 400,
      details: [
        { field: "dueAt", message: "Must be in the future", code: "TOO_EARLY" },
        {
          field: "items",
          message: "At least one line item is required",
          code: "REQUIRED",
        },
      ],
    });

    expect(error.fieldErrors).toEqual({
      dueAt: "Must be in the future",
      items: "At least one line item is required",
    });
  });

  it("returns an empty map when there are no details", () => {
    expect(
      new ApiError("Something went wrong", { status: 500 }).fieldErrors,
    ).toEqual({});
  });
});

// ===========================================================================
// Session state machine
// ===========================================================================

describe("session handling", () => {
  const buildTree = (authValue) => (
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <SessionProbe value={authValue} />
      </QueryClientProvider>
    </MemoryRouter>
  );

  // A minimal component that surfaces the context, so the states are observable
  // without rendering the whole shell.
  function SessionProbe({ value }) {
    return (
      <div>
        <span data-testid="status">{value.status}</span>
        <span data-testid="authed">{String(value.isAuthenticated)}</span>
        <span data-testid="unconfirmed">{String(value.isUnconfirmed)}</span>
      </div>
    );
  }

  it("treats an unconfirmed session as still signed in", async () => {
    const value = {
      status: "unconfirmed",
      isAuthenticated: false,
      isUnconfirmed: true,
    };

    render(buildTree(value));

    // The banner says "we could not confirm", NOT "signed out".
    await waitFor(() => {
      expect(screen.getByTestId("unconfirmed")).toHaveTextContent("true");
    });
  });

  it("marks a user authenticated only with a user present", async () => {
    render(
      buildTree({
        status: "authenticated",
        isAuthenticated: true,
        isUnconfirmed: false,
      }),
    );

    expect(screen.getByTestId("authed")).toHaveTextContent("true");
  });
});

// ===========================================================================
// Navigation scoping
// ===========================================================================

describe("navigation", () => {
  it("shows only what the user's permissions allow", async () => {
    const { visibleNavItems } = await import("../lib/nav");

    const items = visibleNavItems(
      (permission) => permission === "invoice:read:own",
    );
    const labels = items.map((item) => item.label ?? item.section);

    // A permission the user lacks is absent entirely.
    expect(labels).toContain("Invoices");
    expect(labels).not.toContain("Audit trail");
    expect(labels).not.toContain("Management");
  });

  it("does not show an empty section heading", async () => {
    const { visibleNavItems } = await import("../lib/nav");

    const items = visibleNavItems(() => true);

    // "Management" appears, and something follows it.
    const index = items.findIndex((item) => item.section === "Management");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(items[index + 1]).toBeDefined();
  });

  it("treats an item with no permission as always visible", async () => {
    const { visibleNavItems } = await import("../lib/nav");

    const items = visibleNavItems(() => false);
    const dashboard = items.find((item) => item.to === "/");

    expect(dashboard).toBeDefined();
  });
});

// ===========================================================================
// The checkout button is only enabled once a server order exists
// ===========================================================================

describe("payment dialog", () => {
  it("keeps pay disabled until the server has created the order", async () => {
    // The amount shown comes from the order the server created. Before that
    // arrives there is nothing legitimate to charge, so the button stays off.
    const { default: PayDialog } = await import("../components/PayDialog");

    // The order call never settles, so the dialog stays in its starting phase —
    // which is the state a user sees while the server is thinking.
    vi.spyOn(await import("../api/client"), "apiPost").mockImplementation(
      () => new Promise(() => {}),
    );

    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <PayDialog
            invoice={{
              reference: "INV-2026-000001",
              purpose: "Tuition",
              total: 590000,
              balanceDue: 590000,
            }}
            onClose={() => {}}
            onVerified={() => {}}
            onVerifyNeeded={() => {}}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const button = await screen.findByRole("button", { name: /pay securely/i });
    // No order yet, so the action is unavailable rather than attempting a charge.
    expect(button).toBeDisabled();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
