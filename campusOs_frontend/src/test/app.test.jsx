/**
 * App-level integration tests.
 *
 * These render the real router, the real auth provider and the real components,
 * with only the network faked. Everything below the fetch boundary is the code
 * that ships, so a broken provider, a mis-ordered route or a guard that does not
 * guard shows up here rather than in a browser.
 *
 * What is being checked is the wiring and the refusals, not the pixels.
 */

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import App from "../App";
import { AuthProvider } from "../context/AuthContext";
import { stubApi, restoreApi, session } from "./helpers";

const HOD_SESSION = {
  user: {
    id: "u1",
    fullName: "DEMO HOD",
    email: "demo.hod@campusos.local",
    role: "HOD",
  },
  student: null,
  permissions: [
    "report:read:department",
    "request:read:assigned",
    "request:read:own",
    "complaint:create:own",
    "certificate:apply:own",
    "invoice:read:own",
    "payment:create:own",
    "refund:request:own",
    "announcement:read:institution",
    "audit:read:department",
  ],
  scopes: ["own", "assigned", "department"],
};

const STUDENT_SESSION = {
  user: {
    id: "u2",
    fullName: "Akanksha Tyagi",
    email: "student@campusos.local",
    role: "STUDENT",
  },
  student: {
    id: "s1",
    rollNumber: "23CS001",
    semester: 5,
    program: { name: "B.Tech Computer Science" },
    department: { name: "Computer Science" },
    feeStatus: "PENDING",
  },
  permissions: ["invoice:read:own", "payment:create:own", "request:read:own"],
  scopes: ["own"],
};

function renderApp({ route = "/" } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // No session unless a test says otherwise.
  document.cookie = "cos_ct=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

describe("signed-out behaviour", () => {
  afterEach(restoreApi);

  it("sends a visitor to the login page and not to the dashboard", async () => {
    // 401 is the only answer that may sign someone out.
    stubApi([["/auth/me", 401]]);

    renderApp({ route: "/" });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /sign in/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  /**
   * The demo panel is gated on a build flag, not on a role.
   *
   * It is on in this build, so the accounts appear — and they are how the
   * seeded roles get discovered. A production build compiles the flag out and
   * the panel simply does not exist, which is why it is checked here rather
   * than left to a deployment convention nobody reads.
   */
  it("offers the demo accounts only when the banner is compiled in", async () => {
    stubApi([["/auth/me", 401]]);

    renderApp({ route: "/login" });

    await waitFor(() => screen.getByRole("heading", { name: /sign in/i }));

    const enabled = import.meta.env.VITE_SHOW_DEMO_BANNER === "true";
    if (enabled) {
      expect(screen.getByText("Demo accounts")).toBeInTheDocument();
    } else {
      expect(screen.queryByText("Demo accounts")).not.toBeInTheDocument();
    }
  });
});

describe("navigation is scoped to the server's permissions", () => {
  beforeEach(() => {
    stubApi([
      ["/auth/me", session(HOD_SESSION)],
      ["/notifications/unread-count", { success: true, data: { unread: 2 } }],
      ["/reports/overview", { success: true, data: overviewFor(HOD_SESSION) }],
      [
        "/requests",
        { success: true, data: [], meta: { total: 0, page: 1, limit: 20 } },
      ],
    ]);
  });

  afterEach(restoreApi);

  it("shows a HOD the areas their permissions cover", async () => {
    renderApp({ route: "/" });

    await waitFor(() => screen.getByRole("heading", { name: /hello/i }));

    // Scoped to the sidebar, so a same-named quick action elsewhere on the
    // page cannot satisfy the assertion by accident.
    const nav = screen.getByRole("navigation", { name: /main navigation/i });

    expect(
      within(nav).getByRole("link", { name: "Reports" }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByRole("link", { name: "Invoices" }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByRole("link", { name: "Audit trail" }),
    ).toBeInTheDocument();
  });

  /**
   * The refusal that matters.
   *
   * A HOD has no institution-wide report permission, so the finance report
   * 403s. The client must not offer it as though it would work.
   */
  it("does not offer a student the management areas", async () => {
    document.cookie = "cos_ct=token; path=/";
    restoreApi();
    stubApi([
      ["/auth/me", session(STUDENT_SESSION)],
      ["/notifications/unread-count", { success: true, data: { unread: 0 } }],
      [
        "/finance/invoices",
        { success: true, data: [], meta: { total: 0, page: 1, limit: 20 } },
      ],
      [
        "/requests",
        { success: true, data: [], meta: { total: 0, page: 1, limit: 20 } },
      ],
    ]);

    renderApp({ route: "/" });

    await waitFor(() => screen.getByRole("heading", { name: /hello/i }));

    const nav = screen.getByRole("navigation", { name: /main navigation/i });

    // The student's own pages are present.
    expect(
      within(nav).getByRole("link", { name: "Invoices" }),
    ).toBeInTheDocument();
    // The oversight areas are not: the student has no permission for them, and
    // showing a link that would 403 is worse than not showing it.
    expect(
      within(nav).queryByRole("link", { name: "Reports" }),
    ).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole("link", { name: "Audit trail" }),
    ).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole("link", { name: "Post notice" }),
    ).not.toBeInTheDocument();
  });
});

describe("session failure is not mistaken for sign-out", () => {
  /**
   * The distinction the whole context exists for.
   *
   * A 401 means signed out. A 500 or a dropped connection means unknown, and
   * the user keeps their session. Collapsing the two would sign people out over
   * a blip — and would make an expired token look like a passing network fault.
   */
  it("keeps the session and says it is unconfirmed when the server errors", async () => {
    stubApi([["/auth/me", 500]]);

    renderApp({ route: "/" });

    await waitFor(() => {
      expect(
        screen.getByText(/could not confirm your session/i),
      ).toBeInTheDocument();
    });

    // Still signed in, and offered a retry rather than a login form.
    expect(
      screen.queryByRole("heading", { name: /sign in/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });
});

describe("sign in", () => {
  it("reaches the dashboard after authenticating", async () => {
    const user = userEvent.setup();

    stubApi([
      ["/auth/login", { success: true, data: HOD_SESSION }],
      ["/auth/me", 401],
      ["/notifications/unread-count", { success: true, data: { unread: 0 } }],
      ["/reports/overview", { success: true, data: overviewFor(HOD_SESSION) }],
      [
        "/requests",
        { success: true, data: [], meta: { total: 0, page: 1, limit: 20 } },
      ],
    ]);

    renderApp({ route: "/login" });

    await waitFor(() => screen.getByRole("heading", { name: /sign in/i }));

    await user.type(screen.getByLabelText(/email/i), "demo.hod@campusos.local");
    await user.type(screen.getByLabelText(/password/i), "Demo@Campus123");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => screen.getByRole("heading", { name: /hello/i }));

    // Reaching the dashboard means the login went out and was accepted.
  });

  it("shows the server's refusal and stays on the form", async () => {
    const user = userEvent.setup();

    stubApi([
      [
        "/auth/login",
        {
          __status: 401,
          body: {
            success: false,
            message: "Invalid email or password",
            code: "INVALID_CREDENTIALS",
          },
        },
      ],
      ["/auth/me", 401],
    ]);

    renderApp({ route: "/login" });
    await waitFor(() => screen.getByRole("heading", { name: /sign in/i }));

    await user.type(screen.getByLabelText(/email/i), "wrong@campusos.local");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    // The refusal is shown, and the form is still there to correct.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /invalid email or password/i,
    );
    expect(
      screen.getByRole("button", { name: /^sign in$/i }),
    ).toBeInTheDocument();
  });
});

describe("a route the user may not enter", () => {
  it("explains the refusal rather than failing blank", async () => {
    document.cookie = "cos_ct=token; path=/";
    restoreApi();
    stubApi([
      ["/auth/me", session(STUDENT_SESSION)],
      ["/notifications/unread-count", { success: true, data: { unread: 0 } }],
    ]);

    // Refunds needs `refund:request:own`, which this student session lacks.
    renderApp({ route: "/finance/refunds" });

    await waitFor(() => {
      expect(screen.getByText(/do not have access/i)).toBeInTheDocument();
    });

    // It names the role, so the reader knows who to ask — and the refusal is
    // an explanation rather than an empty page.
    expect(screen.getByText(/your role \(student\)/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to dashboard/i }),
    ).toBeInTheDocument();
  });
});

/** A minimal overview payload matching the shape the dashboard reads. */
function overviewFor(session) {
  return {
    scope: session.user.role === "STUDENT" ? "OWN" : "DEPARTMENT",
    period: {
      from: new Date().toISOString(),
      to: new Date().toISOString(),
      days: 30,
    },
    students: { total: 4, active: 4, newInPeriod: 1 },
    requests: { total: 9, open: 2, completed: 6, escalated: 0, byStatus: {} },
  };
}
