/**
 * The forced password change.
 *
 * An administrator-provisioned account still works on a password the institute
 * knows. Until that is replaced, this is the only screen it can reach — no
 * shell, no navigation, nothing else to look at on the way past.
 *
 * The gate is a courtesy, not a control: the server enforces every permission
 * regardless. What these tests protect is that the person is not *shown* the
 * rest of the application first.
 */

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import App from "../App";
import { AuthProvider } from "../context/AuthContext";
import { restoreApi, session, stubApi } from "./helpers";

const GATED_SESSION = session({
  user: {
    id: "u9",
    fullName: "New Joiner",
    email: "new.joiner@campusos.local",
    role: "LIBRARY_ADMIN",
    mustChangePassword: true,
  },
  permissions: ["request:read:own"],
  scopes: ["own"],
});

const READY_SESSION = session({
  user: {
    id: "u9",
    fullName: "New Joiner",
    email: "new.joiner@campusos.local",
    role: "LIBRARY_ADMIN",
    mustChangePassword: false,
  },
  permissions: ["request:read:own"],
  scopes: ["own"],
});

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
  document.cookie = "cos_ct=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

afterEach(restoreApi);

describe("an account that owes a password change", () => {
  it("is held at the password screen", async () => {
    stubApi([["/auth/me", GATED_SESSION]]);
    renderApp({ route: "/" });

    expect(
      await screen.findByRole("heading", { name: /choose your password/i }),
    ).toBeInTheDocument();
  });

  /**
   * The point of the gate. Landing on the dashboard instead would show the
   * person a page of other people's business before they had set a password
   * the institute does not know.
   */
  it("cannot reach the dashboard, even by typing the address", async () => {
    stubApi([["/auth/me", GATED_SESSION]]);
    renderApp({ route: "/" });

    await screen.findByRole("heading", { name: /choose your password/i });

    expect(screen.queryByRole("link", { name: /requests/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /sign out$/i })).toBeNull();
  });

  it("does not offer to leave without replacing it", async () => {
    stubApi([["/auth/me", GATED_SESSION]]);
    renderApp();

    await screen.findByRole("heading", { name: /choose your password/i });

    // Signing out is allowed; navigating anywhere else is not.
    expect(
      screen.getByRole("button", { name: /sign out instead/i }),
    ).toBeInTheDocument();
  });

  it("asks for the temporary password before accepting a new one", async () => {
    const user = userEvent.setup();
    stubApi([["/auth/me", GATED_SESSION]]);
    renderApp();

    await user.type(
      await screen.findByLabelText(/^new password/i),
      "SomethingStrong2026",
    );
    await user.type(
      screen.getByLabelText(/^confirm new password/i),
      "SomethingStrong2026",
    );

    // Without the temporary password there is nothing to prove they received it.
    expect(
      screen.getByRole("button", { name: /set password and sign in/i }),
    ).toBeDisabled();
  });

  it("refuses a mismatched confirmation before sending anything", async () => {
    const user = userEvent.setup();
    stubApi([["/auth/me", GATED_SESSION]]);
    renderApp();

    await user.type(
      await screen.findByLabelText(/temporary password/i),
      "Temp-9x2Kq",
    );
    await user.type(
      screen.getByLabelText(/^new password/i),
      "SomethingStrong2026",
    );
    await user.type(
      screen.getByLabelText(/^confirm new password/i),
      "SomethingDifferent2026",
    );

    expect(screen.getByText(/two passwords do not match/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /set password and sign in/i }),
    ).toBeDisabled();
  });

  it("says what a new password has to look like", async () => {
    const user = userEvent.setup();
    stubApi([["/auth/me", GATED_SESSION]]);
    renderApp();

    await screen.findByLabelText(/^new password/i);
    // The hint is shown until the field is wrong; after that the error replaces
    // it, so the rule is read before typing rather than after.
    expect(screen.getByText(/upper-case letter/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^new password/i), "short");
    expect(screen.getByText(/too short/i)).toBeInTheDocument();
  });

  it("does not let anyone in on a wrong temporary password", async () => {
    const user = userEvent.setup();
    stubApi([
      [
        "/profile/change-password",
        {
          __status: 401,
          body: {
            success: false,
            message: "Current password is incorrect",
            code: "INVALID_CREDENTIALS",
          },
        },
      ],
      ["/auth/me", GATED_SESSION],
    ]);
    renderApp();

    await user.type(
      await screen.findByLabelText(/temporary password/i),
      "NotItAtAll",
    );
    await user.type(
      screen.getByLabelText(/^new password/i),
      "SomethingStrong2026",
    );
    await user.type(
      screen.getByLabelText(/^confirm new password/i),
      "SomethingStrong2026",
    );

    await user.click(
      screen.getByRole("button", { name: /set password and sign in/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /current password is incorrect/i,
    );
  });
});

describe("an account that does not owe one", () => {
  it("is never shown the screen", async () => {
    stubApi([
      ["/auth/me", READY_SESSION],
      [
        "/profile",
        {
          success: true,
          data: {
            user: {
              id: "u9",
              fullName: "New Joiner",
              email: "n@campusos.local",
              role: "LIBRARY_ADMIN",
            },
            student: null,
            account: { loginCount: 1 },
            permissions: [],
            scopes: ["own"],
          },
        },
      ],
    ]);
    renderApp({ route: "/profile" });

    await screen.findByRole("heading", { name: /your profile/i });

    expect(
      screen.queryByRole("heading", { name: /choose your password/i }),
    ).toBeNull();
  });
});
