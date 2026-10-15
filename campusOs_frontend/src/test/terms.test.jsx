import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, afterEach } from "vitest";

import Terms from "../pages/admin/Terms";
import { stubApi, restoreApi } from "./helpers";

/**
 * The academic terms screen.
 *
 * Two behaviours are protected here, and both are about what the screen must
 * *not* let happen: it must never imply a term is open when none is, and it
 * must never offer Delete on the term whose figures are currently accruing.
 */

const CURRENT = {
  _id: "term-1",
  name: "Autumn 2026",
  code: "A26",
  kind: "SEMESTER",
  academicYear: "2026-27",
  startsOn: "2026-08-01T00:00:00.000Z",
  endsOn: "2026-12-20T00:00:00.000Z",
  isCurrent: true,
  status: "OPEN",
  counts: { students: 120, invoices: 118, certificates: 42, requests: 9 },
};

const PLANNED = {
  _id: "term-2",
  name: "Spring 2027",
  code: "S27",
  kind: "SEMESTER",
  academicYear: "2026-27",
  startsOn: "2027-01-05T00:00:00.000Z",
  endsOn: "2027-05-30T00:00:00.000Z",
  isCurrent: false,
  status: "PLANNED",
  counts: { students: 0, invoices: 0, certificates: 0, requests: 0 },
};

function renderTerms() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Terms />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubTerms(terms) {
  stubApi([["/academic-terms", { success: true, data: { terms } }]]);
}

describe("academic terms screen", () => {
  afterEach(() => restoreApi());

  it("names the open term and offers to close it", async () => {
    stubTerms([CURRENT]);
    renderTerms();

    // `findAll`, because the name appears twice by design: in the banner above
    // and in its own row. And it waits for content rather than for the
    // container — the banner mounts before the query returns, so asserting on
    // it immediately reads the initial empty state.
    await screen.findAllByText("Autumn 2026");

    expect(screen.getByText(/120 students/)).toBeInTheDocument();
    expect(screen.getByText(/42 certificates/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /close this term/i }),
    ).toBeInTheDocument();
  });

  it("says plainly when no term is open", async () => {
    // A college between terms is a real state, and the screen must not merely
    // look empty.
    stubTerms([PLANNED]);
    renderTerms();

    await screen.findAllByText("Spring 2027");
    expect(screen.getByText(/no term is currently open/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /close this term/i }),
    ).not.toBeInTheDocument();
  });

  it("never offers Delete on the current term", async () => {
    // Deleting the term figures are currently accruing under would orphan them.
    stubTerms([CURRENT]);
    renderTerms();

    await screen.findAllByText("Autumn 2026");
    expect(
      screen.queryByRole("button", { name: /delete/i }),
    ).not.toBeInTheDocument();
  });

  it("offers Delete on a term that is not current", async () => {
    stubTerms([PLANNED]);
    renderTerms();

    await screen.findAllByText("Spring 2027");
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("opens an edit dialog that refuses to move a closed term's dates", async () => {
    const closed = { ...PLANNED, name: "Spring 2026", status: "CLOSED" };
    stubTerms([closed]);
    renderTerms();

    await screen.findAllByText("Spring 2026");
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));

    // The reason must be visible while the fields are disabled, or the reader
    // concludes the form is broken.
    expect(await screen.findByText(/cannot move/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/starts on/i)).toBeDisabled();
    expect(screen.getByLabelText(/ends on/i)).toBeDisabled();
  });

  it("creates a term through a dialog that defaults the dates to today", async () => {
    stubTerms([]);
    renderTerms();

    await userEvent.click(screen.getByRole("button", { name: /new term/i }));

    const today = new Date().toISOString().slice(0, 10);
    expect(screen.getByLabelText(/starts on/i)).toHaveValue(today);
    expect(screen.getByLabelText(/ends on/i)).toHaveValue(today);
  });
});
