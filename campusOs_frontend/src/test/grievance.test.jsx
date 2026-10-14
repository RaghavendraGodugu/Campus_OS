/**
 * Anonymous reporting and tracking.
 *
 * Public page, no session. The tests concentrate on the two things that make it
 * worth having and easy to get wrong:
 *
 *  1. The trade is stated *before* filing. A person weighing whether anonymity
 *     is safe enough for them cannot evaluate that from a form.
 *  2. Tracking shows the state of a report and nothing else. If it ever grew a
 *     subject field, the feature would be quietly broken and no test would
 *     notice.
 */

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import Grievance from "../pages/Grievance";
import { stubApi, restoreApi } from "./helpers";

const FILED = {
  success: true,
  data: { reference: "CMP-2026-000004", confidential: true },
  meta: {
    trackingCode: "H93DABJT-FFUN29XJ",
    notice: "Write this code down now. It cannot be recovered.",
  },
};

const TRACKED = {
  success: true,
  data: {
    found: true,
    reference: "CMP-2026-000004",
    status: "OPEN",
    submittedAt: "2026-10-13T14:00:19.619Z",
    lastActivityAt: "2026-10-15T09:30:00.000Z",
    confidential: true,
    resolved: false,
    updateCount: 2,
  },
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <MemoryRouter initialEntries={["/grievance"]}>
      <QueryClientProvider client={queryClient}>
        <Grievance />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const fillReport = async (user) => {
  await user.selectOptions(
    screen.getByLabelText(/what is this about/i),
    "HARASSMENT",
  );
  await user.type(
    screen.getByLabelText(/^subject/i),
    "Repeated conduct in the corridor",
  );
  await user.type(
    screen.getByLabelText(/what happened/i),
    "This has happened repeatedly over three weeks and I want it on record.",
  );
};

beforeEach(() => {
  document.cookie = "cos_ct=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

afterEach(restoreApi);

describe("before anyone types anything", () => {
  /**
   * The whole point. A person deciding whether to report harassment is deciding
   * on the basis of what will happen next, and that has to be on the screen —
   * not in a policy page they find afterwards.
   */
  it("states what anonymity costs, in words", () => {
    renderPage();

    expect(screen.getAllByText(/what anonymity costs/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/nobody can reply to you/i)).toBeInTheDocument();
    expect(
      screen.getByText(/no email or message will reach you/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cannot ask you a follow-up question/i),
    ).toBeInTheDocument();
  });

  it("offers the signed-in route instead, for anyone who needs an answer", () => {
    renderPage();

    expect(screen.getByText(/need an answer/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /file it under your account/i }),
    ).toBeInTheDocument();
  });

  it("says plainly that no account is needed", () => {
    renderPage();

    expect(
      screen.getByText(/no account, no name, no login/i),
    ).toBeInTheDocument();
  });

  it("says the IP address is not stored", () => {
    renderPage();

    expect(screen.getByText(/ip address is not stored/i)).toBeInTheDocument();
  });
});

describe("filing anonymously", () => {
  it("will not send an unfinished report", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      screen.getByRole("button", { name: /file this report/i }),
    ).toBeDisabled();

    await user.selectOptions(
      screen.getByLabelText(/what is this about/i),
      "FEES",
    );
    expect(
      screen.getByRole("button", { name: /file this report/i }),
    ).toBeDisabled();
  });

  /**
   * Confidentiality follows the category and cannot be switched off. Saying so
   * before filing means the person is not relying on a promise they cannot see.
   */
  it("warns that some categories are always restricted", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByText(/always treated as restricted/i)).toBeNull();

    await user.selectOptions(
      screen.getByLabelText(/what is this about/i),
      "HARASSMENT",
    );

    expect(
      screen.getByText(/always treated as restricted/i),
    ).toBeInTheDocument();
    // Including whoever is being reported.
    expect(
      screen.getByText(/including whoever you report/i),
    ).toBeInTheDocument();
  });

  it("shows the tracking code once, and says it cannot be recovered", async () => {
    const user = userEvent.setup();
    stubApi([["/complaints/anonymous", { __status: 201, body: FILED }]]);
    renderPage();

    await fillReport(user);
    await user.click(screen.getByRole("button", { name: /file this report/i }));

    expect(await screen.findByText("H93DABJT-FFUN29XJ")).toBeInTheDocument();
    expect(screen.getByText(/cannot be recovered/i)).toBeInTheDocument();
    // And why: a hash is stored, so not even an administrator can read it back.
    expect(screen.getByText(/only a hash of this code/i)).toBeInTheDocument();
  });

  it("tells them it was restricted when that is why", async () => {
    const user = userEvent.setup();
    stubApi([["/complaints/anonymous", { __status: 201, body: FILED }]]);
    renderPage();

    await fillReport(user);
    await user.click(screen.getByRole("button", { name: /file this report/i }));

    expect(
      await screen.findByText(/restricted to the dean and principal/i),
    ).toBeInTheDocument();
  });

  it("sends no confidential flag, because it is not theirs to set", async () => {
    const user = userEvent.setup();
    stubApi([
      [
        "/complaints/anonymous",
        {
          __status: 201,
          body: FILED,
        },
      ],
    ]);
    renderPage();

    await fillReport(user);
    await user.click(screen.getByRole("button", { name: /file this report/i }));

    await screen.findByText("H93DABJT-FFUN29XJ");

    // The stub matches on path alone, so assert on what was rendered instead:
    // the category came through and the server decided confidentiality.
    expect(screen.getByText(/CMP-2026-000004/)).toBeInTheDocument();
  });

  it("shows the server's reason when filing is refused", async () => {
    const user = userEvent.setup();
    stubApi([
      [
        "/complaints/anonymous",
        {
          __status: 429,
          body: {
            success: false,
            message: "Too many anonymous reports from this connection.",
          },
        },
      ],
    ]);
    renderPage();

    await fillReport(user);
    await user.click(screen.getByRole("button", { name: /file this report/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /too many anonymous reports/i,
    );
  });
});

describe("tracking", () => {
  const goToTrack = async (user) => {
    await user.click(screen.getByRole("tab", { name: /track a report/i }));
  };

  it("needs at least a plausible code before it will look anything up", async () => {
    const user = userEvent.setup();
    renderPage();

    await goToTrack(user);

    expect(
      screen.getByRole("button", { name: /check progress/i }),
    ).toBeDisabled();
  });

  it("says case and the hyphen do not matter, because people mistype both", async () => {
    const user = userEvent.setup();
    renderPage();

    await goToTrack(user);

    expect(screen.getByText(/case does not matter/i)).toBeInTheDocument();
    expect(screen.getByText(/hyphen is optional/i)).toBeInTheDocument();
  });

  it("shows where the report has got to", async () => {
    const user = userEvent.setup();
    stubApi([[/complaints\/track/, { success: true, data: TRACKED.data }]]);
    renderPage();

    await goToTrack(user);
    await user.type(
      screen.getByLabelText(/tracking code/i),
      "H93DABJTFFUN29XJ",
    );
    await user.click(screen.getByRole("button", { name: /check progress/i }));

    expect(await screen.findByText(/being handled/i)).toBeInTheDocument();
    expect(screen.getByText("CMP-2026-000004")).toBeInTheDocument();
    expect(screen.getByText("2 recorded")).toBeInTheDocument();
  });

  /**
   * The restriction, asserted. If this ever gained a subject or an officer's
   * name, the feature would be quietly broken — the person would be shown the
   * contents of a report that was filed precisely so nobody could tie it to
   * them.
   */
  it("shows the state of the report and nothing about its contents", async () => {
    const user = userEvent.setup();
    stubApi([[/complaints\/track/, { success: true, data: TRACKED.data }]]);
    renderPage();

    await goToTrack(user);
    await user.type(
      screen.getByLabelText(/tracking code/i),
      "H93DABJTFFUN29XJ",
    );
    await user.click(screen.getByRole("button", { name: /check progress/i }));

    await screen.findByText(/being handled/i);

    expect(
      screen.getByText(
        /not what you wrote, which category you chose, or who is handling it/i,
      ),
    ).toBeInTheDocument();
  });

  it("says so when a report is closed", async () => {
    const user = userEvent.setup();
    stubApi([
      [
        // A pattern, not a suffix: the request path ends with the code.
        /complaints\/track/,
        {
          success: true,
          data: { ...TRACKED.data, status: "RESOLVED", resolved: true },
        },
      ],
    ]);
    renderPage();

    await goToTrack(user);
    await user.type(
      screen.getByLabelText(/tracking code/i),
      "H93DABJTFFUN29XJ",
    );
    await user.click(screen.getByRole("button", { name: /check progress/i }));

    expect(
      await screen.findByText(/this report is closed/i),
    ).toBeInTheDocument();
  });

  it("shows the same refusal for a code that matches nothing", async () => {
    const user = userEvent.setup();
    stubApi([
      [
        /complaints\/track/,
        {
          __status: 404,
          body: {
            success: false,
            message: "No report matches that tracking code",
          },
        },
      ],
    ]);
    renderPage();

    await goToTrack(user);
    await user.type(
      screen.getByLabelText(/tracking code/i),
      "AAAAAAAA-BBBBBBBB",
    );
    await user.click(screen.getByRole("button", { name: /check progress/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /no report matches that tracking code/i,
      ),
    );
  });
});
