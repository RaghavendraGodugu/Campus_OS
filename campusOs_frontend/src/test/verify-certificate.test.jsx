/**
 * Public certificate verification.
 *
 * This page is reached by people who are not signed in, holding a piece of
 * paper. So the things worth testing are the three answers it can give and the
 * fact that it keeps them apart: "not recognised", "recognised but revoked",
 * and "genuine". Collapsing the middle case into the first would tell a bank
 * nothing about whether the student did something wrong.
 *
 * It also must not disclose who a certificate belongs to — the endpoint does not
 * return a name, and the page must not invent one.
 */

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import VerifyCertificate from "../pages/VerifyCertificate";
import { stubApi, stubApiRecording, restoreApi } from "./helpers";

const AUTHENTIC = {
  success: true,
  data: {
    found: true,
    valid: true,
    reference: "CERT-2026-000007",
    type: "BONAFIDE",
    issuedAt: "2026-10-13T05:35:31.181Z",
    revokedAt: null,
  },
};

const REVOKED = {
  success: true,
  data: {
    ...AUTHENTIC.data,
    valid: false,
    revokedAt: "2026-11-02T09:00:00.000Z",
  },
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <MemoryRouter initialEntries={["/verify"]}>
      <QueryClientProvider client={queryClient}>
        <VerifyCertificate />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Overrides first: stubApi keeps the earlier entry when two match by length. */
function stubVerify(response, status = 200) {
  stubApi([
    [
      "/certificates/verify",
      status === 200 ? response : { __status: status, body: response },
    ],
  ]);
}

const submit = async (user, code) => {
  await user.type(screen.getByLabelText(/verification code/i), code);
  await user.click(screen.getByRole("button", { name: /verify/i }));
};

beforeEach(() => {
  document.cookie = "cos_ct=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

afterEach(restoreApi);

describe("the three answers", () => {
  it("confirms an authentic certificate", async () => {
    const user = userEvent.setup();
    stubVerify(AUTHENTIC);
    renderPage();

    await submit(user, "VNWEDT-WLLZ76");

    expect(
      await screen.findByText(/genuine and currently valid/i),
    ).toBeInTheDocument();
    expect(screen.getByText("CERT-2026-000007")).toBeInTheDocument();
    expect(screen.getByText("Bonafide")).toBeInTheDocument();
  });

  /**
   * Revoked is not the same as unrecognised, and the two are reported
   * differently on purpose.
   */
  it("says a revoked certificate is no longer valid, and when it was withdrawn", async () => {
    const user = userEvent.setup();
    stubVerify(REVOKED);
    renderPage();

    await submit(user, "VNWEDT-WLLZ76");

    expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
    expect(screen.queryByText(/genuine and currently valid/i)).toBeNull();
    // The date is on the page, so the withdrawal is on record.
    // Two-digit day, as the shared date format renders it.
    expect(screen.getByText("02 Nov 2026")).toBeInTheDocument();
  });

  it("says plainly when the code is not recognised", async () => {
    const user = userEvent.setup();
    stubVerify(
      { success: false, message: "No certificate matches that code" },
      404,
    );
    renderPage();

    await submit(user, "NOPE-123456");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no certificate with that code/i,
    );
    // It must not claim the certificate is invalid — we simply have no record.
    expect(screen.queryByText(/no longer valid/i)).toBeNull();
  });

  /**
   * A not-found response must not be reported as "not valid". Telling a bank a
   * certificate is invalid when it has simply never heard of it is a different
   * and much more damaging claim.
   */
  it("does not call an unrecognised code an invalid certificate", async () => {
    const user = userEvent.setup();
    stubVerify(
      { success: false, message: "No certificate matches that code" },
      404,
    );
    renderPage();

    await submit(user, "NOPE-123456");

    await screen.findByRole("alert");
    expect(document.body.textContent).not.toMatch(/is no longer valid/i);
    expect(document.body.textContent).not.toMatch(/authentic/i);
  });
});

describe("what it discloses", () => {
  it("shows no name, because the endpoint returns none", async () => {
    const user = userEvent.setup();
    stubVerify(AUTHENTIC);
    renderPage();

    await submit(user, "VNWEDT-WLLZ76");
    await screen.findByText(/genuine and currently valid/i);

    // Nothing on the page claims to know who holds it.
    expect(document.body.textContent).not.toMatch(/student name|issued to:/i);
    expect(
      screen.getByText(/does not disclose who it was issued to/i),
    ).toBeInTheDocument();
  });

  /**
   * The code travels in the query string, so it is upper-cased before it goes:
   * a lowercase letter would be stripped by the server's pattern and refused
   * for the wrong reason.
   */
  it("normalises what the person typed", async () => {
    const user = userEvent.setup();
    const { requests } = stubApiRecording([
      ["/certificates/verify", AUTHENTIC],
    ]);
    renderPage();

    await submit(user, "vnwedt-wllz76");

    await waitFor(() => {
      const call = requests.find((r) =>
        r.path.includes("/certificates/verify"),
      );
      expect(call?.url).toContain("code=VNWEDT-WLLZ76");
    });
  });
});

describe("the field itself", () => {
  it("will not send a code too short to be real", async () => {
    renderPage();

    expect(screen.getByRole("button", { name: /verify/i })).toBeDisabled();
  });

  it("labels the field for a screen reader", () => {
    renderPage();

    expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
  });
});
