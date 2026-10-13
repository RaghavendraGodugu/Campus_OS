/**
 * The profile page, against the real router and the real auth provider.
 *
 * Only the network is faked. These tests care about one thing above all: that
 * the page does not offer a person an edit the server will refuse. A roll
 * number with a pencil beside it would be a bug, even if the save failed.
 */

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import App from "../App";
import { AuthProvider } from "../context/AuthContext";
import { stubApi, restoreApi, session } from "./helpers";

const STUDENT_PROFILE = {
  user: {
    id: "u2",
    fullName: "Akanksha Tyagi",
    email: "student@campusos.local",
    phone: null,
    role: "STUDENT",
    isActive: true,
    createdAt: "2024-08-01T00:00:00.000Z",
    lastLoginAt: "2026-10-10T09:00:00.000Z",
  },
  student: {
    id: "s1",
    rollNumber: "23CS001",
    semester: 5,
    year: 3,
    section: "A",
    batchYear: 2023,
    feeStatus: "PENDING",
    program: { id: "p1", name: "B.Tech Computer Science", code: "BTCS" },
    department: { id: "d1", name: "Computer Science", code: "CS" },
  },
  department: null,
  account: { loginCount: 14, lastLoginAt: "2026-10-10T09:00:00.000Z" },
  permissions: ["invoice:read:own", "payment:create:own", "request:read:own"],
  scopes: ["own"],
  editableFields: ["fullName", "phone"],
};

const FACULTY_PROFILE = {
  ...STUDENT_PROFILE,
  user: {
    ...STUDENT_PROFILE.user,
    id: "u3",
    fullName: "Dr. Rohan Mehta",
    email: "rohan.mehta@campusos.local",
    role: "FACULTY",
  },
  student: null,
  department: { id: "d1", name: "Computer Science", code: "CS" },
};

function renderApp({ route = "/profile" } = {}) {
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

/**
 * Stub the session and the profile, plus anything a particular test needs.
 *
 * Always re-stubbing the *whole* set matters: replacing the adapter with only the
 * new route leaves the session and profile requests unstubbed, so a background
 * refetch 404s and the page vanishes mid-assertion.
 */
function stubProfile(profile = STUDENT_PROFILE, extra = []) {
  stubApi([
    // Overrides first: `stubApi` sorts by match length and keeps the earlier
    // entry when two are the same length, so an override for "/profile" has to
    // precede the healthy one to take effect.
    ...extra,
    ["/auth/me", session(profile)],
    ["/profile", { success: true, data: profile }],
  ]);
}

beforeEach(() => {
  document.cookie = "cos_ct=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

afterEach(restoreApi);

describe("your profile", () => {
  it("shows your details and your academic record", async () => {
    stubProfile();
    renderApp();

    // Wait for the page's own content, not just the name in the sidebar: the
    // shell shows the name before the profile request has resolved, so
    // asserting on the name first would let the next assertion run too early.
    expect(await screen.findByText("23CS001")).toBeInTheDocument();
    expect(screen.getByText("B.Tech Computer Science")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /your profile/i }),
    ).toBeInTheDocument();
  });

  /**
   * The boundary, made visible.
   *
   * If the page hid the roll number with no explanation, someone seeing it
   * wrong would conclude the application was broken rather than that the
   * records office fixes it.
   */
  it("says the academic record is maintained by the college", async () => {
    stubProfile();
    renderApp();

    const card = (await screen.findByText("Academic record")).closest(
      "section",
    );
    expect(
      within(card).getByText(/maintained by the college/i),
    ).toBeInTheDocument();
  });

  it("does not let a student open an editor for their own roll number", async () => {
    stubProfile();
    renderApp();

    await screen.findByText("23CS001");

    // Exactly one Edit button, and it belongs to the details card.
    const edits = screen.getAllByRole("button", { name: /edit/i });
    expect(edits).toHaveLength(1);

    const details = screen.getByText("Your details").closest("section");
    expect(
      within(details).getByRole("button", { name: /edit/i }),
    ).toBeInTheDocument();

    // No editable field anywhere for the academic record.
    const academic = screen.getByText("Academic record").closest("section");
    expect(within(academic).queryByRole("textbox")).toBeNull();
  });

  it("saves a new name and phone", async () => {
    const user = userEvent.setup();
    stubProfile();
    renderApp();

    await user.click(await screen.findByRole("button", { name: /^edit$/i }));

    const name = screen.getByLabelText(/full name/i);
    await user.clear(name);
    await user.type(name, "Akanksha Tyagi Verma");
    await user.type(screen.getByLabelText(/phone/i), "+91 98765 43210");

    const updated = {
      ...STUDENT_PROFILE,
      user: {
        ...STUDENT_PROFILE.user,
        fullName: "Akanksha Tyagi Verma",
        phone: "+91 98765 43210",
      },
    };
    stubApi([
      ["/profile", { success: true, data: updated }],
      ["/auth/me", session(updated)],
    ]);

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/updated/i);

    // In the profile itself *and* in the shell, because the shell shows the
    // name and would otherwise keep displaying the old one.
    expect(
      screen.getByRole("heading", { name: /your profile/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getAllByText("Akanksha Tyagi Verma").length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  /**
   * The server is the authority, so its refusal is shown rather than swallowed.
   * A silent failure here would look exactly like a broken save button.
   */
  it("shows the reason when the server refuses a field", async () => {
    const user = userEvent.setup();
    stubProfile();
    renderApp();

    await user.click(await screen.findByRole("button", { name: /^edit$/i }));

    const name = screen.getByLabelText(/full name/i);
    await user.clear(name);
    await user.type(name, "Updated Name");

    stubApi([
      [
        "/profile",
        {
          __status: 400,
          body: {
            success: false,
            message:
              "You cannot change rollNumber yourself. Only fullName and phone are yours to edit",
          },
        },
      ],
    ]);

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot change rollNumber/i);
  });

  it("gives staff their department and no academic record", async () => {
    stubProfile(FACULTY_PROFILE);
    renderApp();

    // The department card is what proves the profile itself has loaded, since
    // staff have no academic record to wait for.
    expect(
      await screen.findByText("Dr. Rohan Mehta", { selector: "dd" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Academic record")).toBeNull();
    expect(screen.queryByText(/maintained by the college/i)).toBeNull();
  });

  it("tells you which roles you are in, and that the list is informational", async () => {
    stubProfile();
    renderApp();

    await screen.findByText("23CS001");

    await userEvent.setup().click(screen.getByText(/what my role can do/i));
    expect(screen.getByText(/decided by the server/i)).toBeInTheDocument();
    expect(screen.getByText("payment:create:own")).toBeInTheDocument();
  });
});

describe("when the profile cannot be loaded", () => {
  it("shows the failure and offers a retry, rather than an empty page", async () => {
    stubProfile(STUDENT_PROFILE, [
      [
        "/profile",
        {
          __status: 500,
          body: { success: false, message: "Database unavailable" },
        },
      ],
    ]);
    renderApp();

    // The sweep looks for role="alert", so this assertion and that script's
    // judgement are made from the same signal.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/database unavailable/i);
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });
});

describe("security actions", () => {
  it("changes the password and says what it did to other devices", async () => {
    const user = userEvent.setup();
    stubProfile();
    renderApp();

    await user.click(await screen.findByRole("button", { name: /^change$/i }));

    await user.type(screen.getByLabelText(/current password/i), "TestPass123!");
    await user.type(
      screen.getByLabelText(/^new password/i),
      "NewPassphrase2026x",
    );
    await user.type(
      screen.getByLabelText(/confirm new password/i),
      "NewPassphrase2026x",
    );

    stubApi([
      [
        "/profile/change-password",
        {
          success: true,
          message: "Password changed. All other sessions were signed out.",
        },
      ],
    ]);

    await user.click(
      screen.getByRole("button", { name: /^change password$/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /every other device has been signed out/i,
      ),
    );
  });

  /**
   * Guarded in the interface as well as on the server: a mistyped confirmation
   * should not produce a round trip that fails with a confusing message.
   */
  it("will not submit a password that does not match its confirmation", async () => {
    const user = userEvent.setup();
    stubProfile();
    renderApp();

    await user.click(await screen.findByRole("button", { name: /^change$/i }));

    await user.type(screen.getByLabelText(/current password/i), "TestPass123!");
    await user.type(
      screen.getByLabelText(/^new password/i),
      "NewPassphrase2026x",
    );
    await user.type(
      screen.getByLabelText(/confirm new password/i),
      "DifferentOne2026x",
    );

    expect(screen.getByText(/two passwords do not match/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^change password$/i }),
    ).toBeDisabled();
  });

  it("signs out everywhere", async () => {
    const user = userEvent.setup();
    stubProfile();
    renderApp();

    stubProfile(STUDENT_PROFILE, [
      [
        "/profile/sign-out-everywhere",
        { success: true, message: "Signed out on every other device." },
      ],
    ]);

    await user.click(
      await screen.findByRole("button", { name: /sign out everywhere/i }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /every other device/i,
    );
  });
});
