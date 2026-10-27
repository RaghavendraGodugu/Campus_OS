import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import Events from "../pages/Events";
import { restoreApi, session, stubApi } from "./helpers";
import { AuthProvider } from "../context/AuthContext";

const EVENTS = {
  success: true,
  data: {
    events: [
      {
        id: "ev1",
        title: "Resume clinic",
        description: "Bring your CV; the placement office reads it with you.",
        kind: "SEMINAR",
        venue: "Placement Cell",
        startsAt: new Date(Date.now() + 5 * 86400000).toISOString(),
        status: "PUBLISHED",
        capacity: 60,
        rsvpCount: 3,
        rsvped: false,
      },
      {
        id: "ev2",
        title: "Inter-college fest",
        description: "Two days of sport, music and food in the quadrangle.",
        kind: "CULTURAL",
        venue: "Main quadrangle",
        startsAt: new Date(Date.now() + 40 * 86400000).toISOString(),
        status: "PUBLISHED",
        rsvped: true,
        rsvpCount: 45,
      },
    ],
  },
};

beforeEach(() => {
  document.cookie = "cos_ct=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

afterEach(restoreApi);

function renderEvents(overrides = {}) {
  const who = {
    user: {
      id: "s1",
      fullName: "DEMO Student",
      email: "s@campusos.local",
      role: "STUDENT",
    },
    permissions: ["event:read"],
    scopes: ["own"],
    ...overrides,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  stubApi([
    ["/auth/me", session(who)],
    ["/events", EVENTS],
  ]);

  return render(
    <MemoryRouter initialEntries={["/events"]}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Events />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("the events page", () => {
  it("lists the published programme with the count the server computed", async () => {
    renderEvents();

    const row = (await screen.findByText("Resume clinic")).parentElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("Placement Cell");
    expect(row.textContent).toContain("3/60");
    expect(screen.getByText("Register")).toBeInTheDocument();
  });

  it("shows the registered state, with the seat the student can give back", async () => {
    renderEvents();

    const row = (await screen.findByText("Inter-college fest")).closest("li");
    expect(within(row).getByText("Registered")).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Release seat" }),
    ).toBeInTheDocument();
    expect(within(row).queryAllByText("Register").length).toBe(0);
  });

  it("hides the composer from a role that only reads", async () => {
    renderEvents();

    await screen.findByText("Resume clinic");
    expect(screen.queryByText("New event")).toBeNull();
  });

  it("hands the people who answer for the poster the composer and the cancel", async () => {
    renderEvents({
      user: {
        id: "d1",
        fullName: "DEMO Dean",
        email: "d@campusos.local",
        role: "DEAN",
      },
      permissions: ["event:read", "event:manage:institution"],
      scopes: ["own", "institution"],
    });

    await screen.findByText("Resume clinic");
    expect(screen.getByText("New event")).toBeInTheDocument();
    expect(screen.getAllByText("Cancel event").length).toBe(2);
    expect(screen.getAllByText("PUBLISHED").length).toBe(2);
  });

  it("shows a running count only against a real capacity", async () => {
    renderEvents();

    await screen.findByText("Resume clinic");
    // The clinic has a capacity: the row counts seats against it.
    expect(screen.getByText(/3\/60 registered/)).toBeInTheDocument();

    // The fest has none: no countdown against a ceiling that does not exist.
    const fest = (await screen.findByText("Inter-college fest")).closest("li");
    expect(fest.textContent).not.toMatch(new RegExp("/") + new RegExp("60"));
    expect(fest.textContent).not.toMatch(/45\s*registered/);
    expect(fest.textContent).not.toMatch(/\/\s*45/);
  });
});
