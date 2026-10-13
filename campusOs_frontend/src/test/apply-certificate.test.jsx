/**
 * Applying for a certificate.
 *
 * The type picker is the whole task on this page, and it is a custom control
 * rather than a `<select>`. That is the thing worth testing: it has to behave
 * like a radiogroup for a keyboard, and it has to never let an application go
 * through unchosen.
 */

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ApplyCertificate from "../pages/ApplyCertificate";
import { AuthProvider } from "../context/AuthContext";
import {
  accessibleName,
  restoreApi,
  session,
  stubApi,
  stubApiRecording,
} from "./helpers";

const PROFILE = {
  user: {
    id: "u2",
    fullName: "Akanksha Tyagi",
    email: "student@campusos.local",
    role: "STUDENT",
  },
  student: {
    rollNumber: "23CS001",
    semester: 5,
    program: { name: "B.Tech Computer Science" },
    department: { name: "Computer Science" },
  },
  permissions: ["certificate:apply:own"],
  scopes: ["own"],
};

/**
 * Stands in for the real certificate page, so a test can tell that submitting
 * navigated to the application that was created.
 */
function ApplicationOpened() {
  const { reference } = useParams();
  return <p>Opened {reference}</p>;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <MemoryRouter initialEntries={["/certificates/new"]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Routes>
            <Route path="/certificates/new" element={<ApplyCertificate />} />
            <Route
              path="/certificates/:reference"
              element={<ApplicationOpened />}
            />
          </Routes>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function stubPage(extra = []) {
  stubApi([
    ...extra,
    ["/auth/me", session(PROFILE)],
    ["/profile", { success: true, data: PROFILE }],
  ]);
}

const TYPE_CARDS = [
  "Bonafide certificate",
  "Study certificate",
  "Character certificate",
  "Academic transcript",
  "Course completion",
  "No-dues certificate",
  "Transfer certificate",
  "Migration certificate",
  "Internship certificate",
];

beforeEach(() => {
  document.cookie = "cos_ct=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

afterEach(restoreApi);

describe("choosing a certificate", () => {
  it("offers every certificate the API accepts", async () => {
    stubPage();
    renderPage();

    const group = await screen.findByRole("radiogroup");
    const cards = within(group).getAllByRole("radio");

    expect(cards).toHaveLength(TYPE_CARDS.length);
    // The accessible name is the label alone. A button takes its whole contents
    // as its name otherwise, so each option would be announced as "Bonafide
    // certificate, confirms you are enrolled, with your dates of study,
    // Registrar, bank accounts, passport applications".
    expect(cards.map((card) => accessibleName(card))).toEqual(TYPE_CARDS);
  });

  /**
   * A custom picker has to be a real radiogroup, or it is a set of divs that
   * only respond to a mouse. These are the behaviours a native radio group
   * gives for free and this one has to reproduce.
   */
  it("moves between cards with the arrow keys", async () => {
    const user = userEvent.setup();
    stubPage();
    renderPage();

    const group = await screen.findByRole("radiogroup");
    const cards = within(group).getAllByRole("radio");

    cards[0].focus();
    await user.keyboard("{ArrowRight}");

    expect(cards[1]).toHaveFocus();
    expect(cards[1]).toHaveAttribute("aria-checked", "true");
    expect(cards[0]).toHaveAttribute("aria-checked", "false");

    // Wraps backwards from the first to the last.
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(cards[8]).toHaveAttribute("aria-checked", "true");
  });

  it("keeps only the chosen card in the tab order", async () => {
    const user = userEvent.setup();
    stubPage();
    renderPage();

    const group = await screen.findByRole("radiogroup");
    const cards = within(group).getAllByRole("radio");

    expect(cards[0]).toHaveAttribute("tabindex", "0");
    expect(cards[1]).toHaveAttribute("tabindex", "-1");

    await user.click(cards[4]);
    expect(cards[4]).toHaveAttribute("tabindex", "0");
    expect(cards[0]).toHaveAttribute("tabindex", "-1");
  });

  it("selects with the space bar", async () => {
    const user = userEvent.setup();
    stubPage();
    renderPage();

    const group = await screen.findByRole("radiogroup");
    const cards = within(group).getAllByRole("radio");

    cards[2].focus();
    await user.keyboard(" ");

    expect(cards[2]).toHaveAttribute("aria-checked", "true");
  });
});

describe("submitting", () => {
  /**
   * The payload is what matters here. A form can render a confirmation and still
   * send the wrong field names, a string where a number belongs, or an empty
   * purpose that overwrites what was typed.
   */
  it("sends the chosen type, the purpose and the copy count", async () => {
    const user = userEvent.setup();
    const { requests } = stubApiRecording([
      [
        "/certificates",
        { success: true, data: { reference: "CERT-2026-0042" } },
      ],
      ["/auth/me", session(PROFILE)],
      ["/profile", { success: true, data: PROFILE }],
    ]);

    renderPage();

    const group = await screen.findByRole("radiogroup");
    await user.click(within(group).getAllByRole("radio")[0]);

    await user.type(
      screen.getByLabelText(/what do you need it for/i),
      "Bank account at HDFC",
    );
    await user.click(screen.getByLabelText("One more copy"));
    await user.click(screen.getByLabelText("One more copy"));

    await user.click(
      screen.getByRole("button", { name: /submit application/i }),
    );

    await waitFor(() => {
      const post = requests.find(
        (r) => r.method === "post" && r.path.endsWith("/certificates"),
      );
      expect(post).toBeDefined();
      expect(post.body).toEqual({
        type: "BONAFIDE",
        purpose: "Bank account at HDFC",
        copies: 3,
      });
    });
  });

  /**
   * An empty purpose is sent as absent, not as "". A blank string would overwrite
   * a real answer with nothing once the record is updated.
   */
  it("omits the purpose entirely when none is given", async () => {
    const user = userEvent.setup();
    const { requests } = stubApiRecording([
      [
        "/certificates",
        { success: true, data: { reference: "CERT-2026-0043" } },
      ],
      ["/auth/me", session(PROFILE)],
      ["/profile", { success: true, data: PROFILE }],
    ]);

    renderPage();

    const group = await screen.findByRole("radiogroup");
    await user.click(within(group).getAllByRole("radio")[3]);
    await user.click(
      screen.getByRole("button", { name: /submit application/i }),
    );

    await waitFor(() => {
      const post = requests.find(
        (r) => r.method === "post" && r.path.endsWith("/certificates"),
      );
      expect(post?.body).toEqual({ type: "TRANSCRIPT", copies: 1 });
      expect(post?.body).not.toHaveProperty("purpose");
    });
  });

  /**
   * The reference is the only handle a student has on the application they just
   * filed, so landing on it is the whole point of submitting.
   */
  it("lands on the application it created", async () => {
    const user = userEvent.setup();

    stubPage([
      [
        "/certificates",
        {
          __status: 200,
          body: { success: true, data: { reference: "CERT-2026-0042" } },
        },
      ],
    ]);
    renderPage();

    const group = await screen.findByRole("radiogroup");
    await user.click(within(group).getAllByRole("radio")[0]);
    await user.click(
      screen.getByRole("button", { name: /submit application/i }),
    );

    expect(await screen.findByText(/opened/i)).toBeInTheDocument();
  });

  it("will not submit with nothing chosen, and says why", async () => {
    stubPage();
    renderPage();

    await screen.findByRole("radiogroup");

    // Submit is disabled before a choice, so the empty submission is not even
    // reachable — the error covers someone who submits by pressing Enter.
    expect(
      screen.getByRole("button", { name: /submit application/i }),
    ).toBeDisabled();
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
  });

  it("shows the server's refusal rather than failing silently", async () => {
    const user = userEvent.setup();
    stubPage();
    renderPage();

    const group = await screen.findByRole("radiogroup");
    await user.click(within(group).getAllByRole("radio")[0]);

    stubPage([
      [
        "/certificates",
        {
          __status: 403,
          body: { success: false, message: "Only student accounts can apply" },
        },
      ],
    ]);

    await user.click(
      screen.getByRole("button", { name: /submit application/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /only student accounts can apply/i,
    );
  });
});

describe("the summary", () => {
  it("reflects the choice as it is made", async () => {
    const user = userEvent.setup();
    stubPage();
    renderPage();

    const summary = (await screen.findByText("Summary")).closest("section");
    expect(within(summary).getByText("Not chosen yet")).toBeInTheDocument();

    const group = screen.getByRole("radiogroup");
    await user.click(within(group).getAllByRole("radio")[1]);

    expect(within(summary).getByText("Study certificate")).toBeInTheDocument();
    // The office text is one paragraph with interpolated parts, so it is read
    // rather than matched on a node.
    expect(summary.textContent).toMatch(/issued by the registrar/i);
  });

  it("states which office issues it", async () => {
    const user = userEvent.setup();
    stubPage();
    renderPage();

    const group = await screen.findByRole("radiogroup");
    // Character certificates are signed by the HoD, not the Registrar.
    await user.click(within(group).getAllByRole("radio")[2]);

    const summary = screen.getByText("Summary").closest("section");
    expect(within(summary).getByText(/issued by the hod/i)).toBeInTheDocument();
  });

  /**
   * There is no student-facing list of departments, and the server takes the
   * student's own. A picker here would offer a choice that does not exist.
   */
  it("does not offer a department to choose", async () => {
    stubPage();
    renderPage();

    await screen.findByRole("radiogroup");
    expect(screen.queryByLabelText(/department/i)).toBeNull();
  });

  it("counts copies, and cannot be pushed past ten", async () => {
    const user = userEvent.setup();
    stubPage();
    renderPage();

    await screen.findByRole("radiogroup");

    const more = screen.getByLabelText("One more copy");
    const fewer = screen.getByLabelText("One fewer copy");

    expect(fewer).toBeDisabled();
    expect(screen.getByLabelText(/number of copies/i)).toHaveTextContent("1");

    await user.click(more);
    expect(screen.getByLabelText(/number of copies/i)).toHaveTextContent("2");
    expect(fewer).toBeEnabled();

    for (let i = 0; i < 12; i += 1) await user.click(more);
    expect(screen.getByLabelText(/number of copies/i)).toHaveTextContent("10");
    expect(more).toBeDisabled();
  });

  it("shows the student's own record, taken from the profile", async () => {
    stubPage();
    renderPage();

    expect(await screen.findByText("23CS001")).toBeInTheDocument();
    expect(screen.getByText("B.Tech Computer Science")).toBeInTheDocument();
  });
});
