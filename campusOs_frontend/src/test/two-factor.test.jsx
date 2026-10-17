import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, afterEach, vi } from "vitest";

import TwoFactorSettings from "../components/TwoFactorSettings";
import { stubApi, stubApiRecording, restoreApi } from "./helpers";

/**
 * Two-factor settings.
 *
 * The parts worth protecting are the ones a screenshot cannot prove: that the
 * recovery codes are shown exactly once, and that turning this off demands a
 * working code rather than a click.
 */

const SECRET = "JBSWY3DPEHPK3PXP";
const RECOVERY = ["a1b2c3d4", "e5f6g7h8", "i9j0k1l2"];

function renderSettings({ enabled = false, onChange } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <TwoFactorSettings enabled={enabled} onChange={onChange} />
    </QueryClientProvider>,
  );
}

describe("two-factor settings", () => {
  afterEach(() => restoreApi());

  it("says plainly what is protecting the account", () => {
    stubApi([]);
    renderSettings({ enabled: false });

    expect(screen.getByText(/password is the only thing/i)).toBeTruthy();
  });

  it("shows the setup key rather than a QR code", async () => {
    stubApi([
      [
        "/auth/2fa/enrol",
        {
          success: true,
          data: { secret: SECRET, provisioningUri: "otpauth://totp/x" },
        },
      ],
    ]);
    renderSettings();

    await userEvent.click(screen.getByRole("button", { name: /turn on/i }));

    // The secret is the whole enrolment; the app can type it.
    expect(await screen.findByText(SECRET)).toBeTruthy();
    expect(screen.getByLabelText(/six-digit code/i)).toBeTruthy();
  });

  it("shows the recovery codes once and then hides them", async () => {
    stubApi([
      [
        "/auth/2fa/enrol",
        {
          success: true,
          data: { secret: SECRET, provisioningUri: "otpauth://totp/x" },
        },
      ],
      [
        "/auth/2fa/confirm",
        { success: true, data: { enabled: true, recoveryCodes: RECOVERY } },
      ],
    ]);
    renderSettings();

    await userEvent.click(screen.getByRole("button", { name: /turn on/i }));
    await screen.findByText(SECRET);
    await userEvent.type(screen.getByLabelText(/six-digit code/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /^turn on$/i }));

    for (const code of RECOVERY) {
      expect(await screen.findByText(code)).toBeTruthy();
    }
    expect(screen.getByText(/will not be shown again/i)).toBeTruthy();

    await userEvent.click(
      screen.getByRole("button", { name: /i have saved them/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /turn on/i }));

    // Gone: a code list that stayed on screen would be a list on a shared
    // machine.
    expect(screen.queryByText(RECOVERY[0])).toBeNull();
  });

  it("sends the code the person typed", async () => {
    const { requests } = stubApiRecording([
      [
        "/auth/2fa/enrol",
        {
          success: true,
          data: { secret: SECRET, provisioningUri: "otpauth://totp/x" },
        },
      ],
      [
        "/auth/2fa/confirm",
        { success: true, data: { enabled: true, recoveryCodes: RECOVERY } },
      ],
    ]);
    renderSettings();

    await userEvent.click(screen.getByRole("button", { name: /turn on/i }));
    await screen.findByText(SECRET);
    await userEvent.type(screen.getByLabelText(/six-digit code/i), "424242");
    await userEvent.click(screen.getByRole("button", { name: /^turn on$/i }));

    const confirm = requests.find((entry) =>
      entry.path.endsWith("/auth/2fa/confirm"),
    );
    expect(confirm.body.code).toBe("424242");
  });

  it("requires a code to turn off, and reports when it is refused", async () => {
    const onChange = vi.fn();
    stubApi([
      [
        "/auth/2fa/disable",
        {
          __status: 400,
          body: { success: false, message: "That code was not accepted." },
        },
      ],
    ]);
    renderSettings({ enabled: true, onChange });

    await userEvent.click(screen.getByRole("button", { name: /turn off/i }));
    await userEvent.type(
      screen.getByLabelText(/enter a code to turn this off/i),
      "000000",
    );
    await userEvent.click(screen.getByRole("button", { name: /^turn off$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not accepted/i);
    // Refused, so nothing changed.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the field empty after a refused code, ready for a retype", async () => {
    stubApi([
      [
        "/auth/2fa/disable",
        {
          __status: 400,
          body: { success: false, message: "That code was not accepted." },
        },
      ],
    ]);
    renderSettings({ enabled: true });

    await userEvent.click(screen.getByRole("button", { name: /turn off/i }));
    await userEvent.type(
      screen.getByLabelText(/enter a code to turn this off/i),
      "000000",
    );
    await userEvent.click(screen.getByRole("button", { name: /^turn off$/i }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText(/enter a code to turn this off/i).value).toBe(
      "",
    );
  });
});
