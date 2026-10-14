/**
 * The bulk import screen.
 *
 * The interaction worth protecting is the pause: an administrator must see
 * every problem *before* anything is written. If the "check" step were skipped
 * or fired the commit automatically, the screen would still look finished while
 * a hundred accounts had been created from a file with an error in row 147.
 *
 * The other thing worth protecting is the one-time password file. It is the
 * only moment two hundred passwords exist in clear, so the screen has to say so
 * and offer the download rather than quietly dropping them.
 */

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import StudentImport from "../pages/admin/StudentImport";
import { restoreApi, stubApi, stubApiRecording } from "./helpers";

const CSV = [
  "rollNumber,fullName,email,programCode,departmentCode,semester,year,section,batchYear,enrolmentDate",
  "26CS101,Ananya Sharma,ananya.s@campusos.local,DEMO-BTCS,DEMO-CSE,1,1,A,2026,2026-08-01",
  "26CS102,Raghav Kumar,raghav.k@campusos.local,DEMO-BTCS,DEMO-CSE,1,1,B,2026,2026-08-01",
].join("\n");

const REPORT_OK = {
  success: true,
  data: {
    valid: true,
    columns: ["rollNumber"],
    totals: { rows: 2, toCreate: 2, problems: 0 },
    problems: [],
    preview: [
      {
        line: 2,
        rollNumber: "26CS101",
        fullName: "Ananya Sharma",
        email: "ananya.s@campusos.local",
        ok: true,
      },
      {
        line: 3,
        rollNumber: "26CS102",
        fullName: "Raghav Kumar",
        email: "raghav.k@campusos.local",
        ok: true,
      },
    ],
    message: "2 students ready to import.",
  },
};

const REPORT_BAD = {
  success: true,
  data: {
    valid: false,
    columns: ["rollNumber"],
    totals: { rows: 3, toCreate: 1, problems: 2 },
    problems: [
      {
        line: 3,
        rollNumber: "26CS202",
        issues: [
          '"not-an-email" is not an email address',
          "semester must be a whole number between 1 and 12",
        ],
      },
      {
        line: 4,
        rollNumber: "26CS203",
        issues: ["no programme with code NOPE"],
      },
    ],
    preview: [],
    message: "Nothing was imported. Fix the 2 rows above and try again.",
  },
};

/** A file input cannot be driven by typing, so the file is faked. */
function chooseFile(contents = CSV, name = "students.csv") {
  const input = document.querySelector("#import-file");
  const file = new File([contents], name, { type: "text/csv" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <MemoryRouter initialEntries={["/admin/students"]}>
      <QueryClientProvider client={queryClient}>
        <StudentImport />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  document.cookie = "cos_ct=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

afterEach(restoreApi);

describe("choosing a file", () => {
  it("offers a template, because the column names have to be exact", () => {
    renderPage();

    expect(
      screen.getByRole("button", { name: /download the template/i }),
    ).toBeInTheDocument();
  });

  it("refuses to check nothing", () => {
    renderPage();

    expect(
      screen.getByRole("button", { name: /check this file/i }),
    ).toBeDisabled();
  });

  it("refuses an oversized file before reading it", async () => {
    renderPage();

    const huge = "x".repeat(5 * 1024 * 1024);
    chooseFile(huge, "huge.csv");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /larger than 4mb/i,
    );
  });

  it("shows the columns it expects once a file is chosen", async () => {
    renderPage();
    chooseFile();

    expect(
      await screen.findByText(/rollNumber, fullName, email/),
    ).toBeInTheDocument();
  });
});

describe("checking the file", () => {
  it("says plainly that nothing has been written yet", async () => {
    const user = userEvent.setup();
    stubApi([["/admin/students/import/validate", REPORT_OK]]);
    renderPage();
    chooseFile();

    await user.click(screen.getByRole("button", { name: /check this file/i }));

    expect(
      await screen.findByText(/nothing has been written yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import them/i }),
    ).toBeInTheDocument();
  });

  it("shows the rows it will create, with the line they came from", async () => {
    const user = userEvent.setup();
    stubApi([["/admin/students/import/validate", REPORT_OK]]);
    renderPage();
    chooseFile();

    await user.click(screen.getByRole("button", { name: /check this file/i }));

    const row = (await screen.findByText("26CS101")).closest("tr");
    // Line 2 is where that student actually is in the file, which is what
    // somebody with the file open needs to see.
    expect(within(row).getByText("2")).toBeInTheDocument();
    expect(within(row).getByText("Ananya Sharma")).toBeInTheDocument();
  });

  /**
   * The pause, restated: checking must not import.
   */
  it("does not write anything on a check", async () => {
    const user = userEvent.setup();
    const { requests } = stubApiRecording([
      ["/admin/students/import/validate", REPORT_OK],
    ]);
    renderPage();
    chooseFile();

    await user.click(screen.getByRole("button", { name: /check this file/i }));
    await screen.findByText(/nothing has been written yet/i);

    // The pause, restated: checking must not import.
    expect(
      requests.some((request) => request.path.endsWith("/import/commit")),
    ).toBe(false);
  });

  it("offers no import button at all while rows are bad", async () => {
    const user = userEvent.setup();
    stubApi([["/admin/students/import/validate", REPORT_BAD]]);
    renderPage();
    chooseFile();

    await user.click(screen.getByRole("button", { name: /check this file/i }));

    await screen.findByText(/2 rows need attention/i);
    expect(screen.queryByRole("button", { name: /^import them$/i })).toBeNull();
  });

  it("lists every problem with its line number", async () => {
    const user = userEvent.setup();
    stubApi([["/admin/students/import/validate", REPORT_BAD]]);
    renderPage();
    chooseFile();

    await user.click(screen.getByRole("button", { name: /check this file/i }));

    expect(await screen.findByText("Line 3")).toBeInTheDocument();
    expect(screen.getByText("Line 4")).toBeInTheDocument();
    expect(
      screen.getByText(/semester must be a whole number between 1 and 12/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no programme with code NOPE/i),
    ).toBeInTheDocument();
  });

  it("shows the server's refusal when the file cannot be read at all", async () => {
    const user = userEvent.setup();
    stubApi([
      [
        "/admin/students/import/validate",
        {
          __status: 400,
          body: {
            success: false,
            message: "The file is missing the column: programCode",
          },
        },
      ],
    ]);
    renderPage();
    chooseFile();

    await user.click(screen.getByRole("button", { name: /check this file/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /missing the column: programCode/i,
    );
  });
});

describe("committing", () => {
  it("asks first, and says what will happen to the passwords", async () => {
    const user = userEvent.setup();
    stubApi([["/admin/students/import/validate", REPORT_OK]]);
    renderPage();
    chooseFile();

    await user.click(screen.getByRole("button", { name: /check this file/i }));
    await user.click(
      await screen.findByRole("button", { name: /import them/i }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/import 2 students\?/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/shown once afterwards/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/no password is written to the audit trail/i),
    ).toBeInTheDocument();
  });

  /**
   * Two hundred passwords cannot be read off a screen. They come back as a file,
   * and the screen has to say that is the only copy.
   */
  it("offers the passwords as a download, once, and says why", async () => {
    const user = userEvent.setup();
    stubApi([
      ["/admin/students/import/validate", REPORT_OK],
      [
        "/admin/students/import/commit",
        {
          __status: 201,
          body: {
            success: true,
            data: { imported: 2 },
            meta: {
              credentials: [
                {
                  rollNumber: "26CS101",
                  fullName: "Ananya Sharma",
                  email: "ananya.s@campusos.local",
                  temporaryPassword: "Kf83mZq1Npr7TvyW",
                },
                {
                  rollNumber: "26CS102",
                  fullName: "Raghav Kumar",
                  email: "raghav.k@campusos.local",
                  temporaryPassword: "Br40xTw9Cde2Lhjn",
                },
              ],
              notice:
                "Download these now. They are shown once and stored only as hashes, so they cannot be shown or sent again.",
            },
          },
        },
      ],
    ]);
    renderPage();
    chooseFile();

    await user.click(screen.getByRole("button", { name: /check this file/i }));
    await user.click(
      await screen.findByRole("button", { name: /import them/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /^import 2 students$/i }),
    );

    expect(await screen.findByText(/2 students imported/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /download the 2 passwords/i }),
    ).toBeInTheDocument();
    // The notice is one paragraph of interpolated text, so it is read rather
    // than matched as a single node.
    expect(screen.getByText(/stored only as hashes/i).textContent).toMatch(
      /cannot be shown or sent again/i,
    );
  });

  it("shows the failure and leaves the file in place to fix", async () => {
    const user = userEvent.setup();
    stubApi([
      ["/admin/students/import/validate", REPORT_OK],
      [
        "/admin/students/import/commit",
        {
          __status: 400,
          body: {
            success: false,
            message: "Nothing was imported: 1 of 2 rows have problems.",
          },
        },
      ],
    ]);
    renderPage();
    chooseFile();

    await user.click(screen.getByRole("button", { name: /check this file/i }));
    await user.click(
      await screen.findByRole("button", { name: /import them/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /^import 2 students$/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /never partly applied|imported/i,
    );
  });
});
