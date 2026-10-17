import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, afterEach } from "vitest";

import ForgotPassword from "../pages/ForgotPassword";
import ResetPassword from "../pages/ResetPassword";
import EmailVerification from "../components/EmailVerification";
import { stubApi, stubApiRecording, restoreApi } from "./helpers";

/**
 * Password reset and email confirmation.
 *
 * The wording on `/forgot-password` is the security property. A page that says
 * "no account with that address" is a page that lists the college, so that test
 * is the important one here.
 */

function renderWithClient(ui, { route = "/" } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const renderForgot = () =>
  renderWithClient(
    <Routes>
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/login" element={<p>Sign in page</p>} />
    </Routes>,
    { route: "/forgot-password" },
  );

describe("forgot password", () => {
  afterEach(() => restoreApi());

  it("sends the address that was typed", async () => {
    const { requests } = stubApiRecording([
      ["/auth/forgot-password", { success: true, data: {} }],
    ]);
    renderForgot();

    await userEvent.type(screen.getByLabelText(/email/i), "student@campus.edu");
    await userEvent.click(
      screen.getByRole("button", { name: /send the link/i }),
    );

    const sent = requests.find((entry) =>
      entry.path.endsWith("/auth/forgot-password"),
    );
    expect(sent.body.email).toBe("student@campus.edu");
  });

  /**
   * The one that matters.
   *
   * The response is identical either way, because the *server* does not
   * distinguish. All the page can do is not invent a difference.
   */
  it("says the same thing whether or not the address is registered", async () => {
    stubApi([["/auth/forgot-password", { success: true, data: {} }]]);
    renderForgot();

    await userEvent.type(screen.getByLabelText(/email/i), "nobody@campus.edu");
    await userEvent.click(
      screen.getByRole("button", { name: /send the link/i }),
    );

    const heading = await screen.findByRole("heading", {
      name: /check your inbox/i,
    });
    expect(heading).toBeTruthy();
    // Conditional wording would be the leak, even conditioned on the address.
    // Split across elements by the highlighted address, so match on the text
    // content rather than on one node.
    const paragraph = screen
      .getByRole("heading", { name: /check your inbox/i })
      .closest("div").parentElement;
    expect(paragraph.textContent).toMatch(/if .* has an account/i);
    expect(screen.queryByText(/no account/i)).toBeNull();
    expect(screen.queryByText(/not registered/i)).toBeNull();
  });

  it("points at the inbox when nothing arrives, without claiming the account is missing", async () => {
    stubApi([["/auth/forgot-password", { success: true, data: {} }]]);
    renderForgot();

    await userEvent.type(screen.getByLabelText(/email/i), "student@campus.edu");
    await userEvent.click(
      screen.getByRole("button", { name: /send the link/i }),
    );

    expect(
      await screen.findByText(
        /may not be registered, or the message may have been filtered/i,
      ),
    ).toBeTruthy();
  });

  it("reports a genuine failure, such as a malformed address", async () => {
    stubApi([
      [
        "/auth/forgot-password",
        {
          __status: 400,
          body: {
            success: false,
            message: "Enter a valid email address",
            details: [
              { field: "email", message: "Enter a valid email address" },
            ],
          },
        },
      ],
    ]);
    renderForgot();

    await userEvent.type(screen.getByLabelText(/email/i), "not-an-email");
    await userEvent.click(
      screen.getByRole("button", { name: /send the link/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /valid email address/i,
    );
  });
});

describe("reset password page", () => {
  afterEach(() => restoreApi());

  const TOKEN = "a".repeat(64);
  const renderReset = () =>
    renderWithClient(
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>,
      { route: `/reset-password?token=${TOKEN}` },
    );

  it("says an expired link has expired, before anything is typed", async () => {
    stubApi([
      [
        "/auth/reset-password/check",
        { success: true, data: { valid: false, reason: "expired" } },
      ],
    ]);
    // window.location.search is what the page reads.
    window.history.pushState({}, "", `/reset-password?token=${TOKEN}`);
    renderReset();

    expect(
      await screen.findByRole("heading", { name: /that link has expired/i }),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
  });

  it("offers a new link when the link is dead", async () => {
    stubApi([
      [
        "/auth/reset-password/check",
        { success: true, data: { valid: false, reason: "invalid" } },
      ],
    ]);
    window.history.pushState({}, "", `/reset-password?token=${TOKEN}`);
    renderReset();

    expect(
      await screen.findByRole("heading", { name: /not valid/i }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /send a new link/i })).toBeTruthy();
  });

  it("refuses to submit when the two entries do not match", async () => {
    const { requests } = stubApiRecording([
      ["/auth/reset-password/check", { success: true, data: { valid: true } }],
      ["/auth/reset-password", { success: true, data: {} }],
    ]);
    window.history.pushState({}, "", `/reset-password?token=${TOKEN}`);
    renderReset();

    await screen.findByLabelText(/new password/i);
    await userEvent.type(
      screen.getByLabelText(/new password/i),
      "LongEnough_9",
    );
    await userEvent.type(
      screen.getByLabelText(/type it again/i),
      "Different_9",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /set the new password/i }),
    );

    expect(await screen.findByText(/these do not match/i)).toBeTruthy();
    expect(
      requests.some((entry) => entry.path.endsWith("/auth/reset-password")),
    ).toBe(false);
  });

  it("says plainly that the other sessions were signed out", async () => {
    stubApi([
      ["/auth/reset-password/check", { success: true, data: { valid: true } }],
      ["/auth/reset-password", { success: true, data: {} }],
    ]);
    window.history.pushState({}, "", `/reset-password?token=${TOKEN}`);
    renderReset();

    await screen.findByLabelText(/new password/i);
    await userEvent.type(
      screen.getByLabelText(/new password/i),
      "LongEnough_9",
    );
    await userEvent.type(
      screen.getByLabelText(/type it again/i),
      "LongEnough_9",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /set the new password/i }),
    );

    expect(
      await screen.findByText(/every other session has been signed out/i),
    ).toBeTruthy();
  });
});

describe("verification shown on the profile", () => {
  afterEach(() => restoreApi());

  const renderBadge = (verified) =>
    renderWithClient(<EmailVerification verified={verified} />);

  it("just says confirmed when the address is proven", () => {
    renderBadge(true);
    expect(screen.getByText(/confirmed/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers a link when it is not", async () => {
    const { requests } = stubApiRecording([
      ["/auth/resend-verification", { success: true, data: {} }],
    ]);
    renderBadge(false);

    await userEvent.click(
      screen.getByRole("button", { name: /send the confirmation link/i }),
    );

    expect(await screen.findByText(/link sent/i)).toBeTruthy();
    expect(
      requests.some((entry) =>
        entry.path.endsWith("/auth/resend-verification"),
      ),
    ).toBe(true);
  });

  it("does not claim it was sent when the request failed", async () => {
    stubApi([
      [
        "/auth/resend-verification",
        {
          __status: 500,
          body: { success: false, message: "Mail is not configured" },
        },
      ],
    ]);
    renderBadge(false);

    await userEvent.click(
      screen.getByRole("button", { name: /send the confirmation link/i }),
    );

    expect(screen.queryByText(/link sent/i)).toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /mail is not configured/i,
    );
  });
});
