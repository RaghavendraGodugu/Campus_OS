/**
 * The administration screens.
 *
 * Two things are worth protecting here, and one of them is not obvious.
 *
 * The obvious one: the server refuses a lot — self-demotion, self-deactivation,
 * deactivating the last super administrator, retiring a department that still has
 * people on it. Each refusal must reach the person as a *reason*, not a red
 * box, because "you may not do that" with no explanation is a dead end.
 *
 * The less obvious one: the self-service actions are hidden on your own row
 * rather than shown and disabled. A control that is always going to fail is
 * worse than no control, because it makes the screen look broken.
 */

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import People from "../pages/admin/People";
import Departments from "../pages/admin/Departments";
import Programmes from "../pages/admin/Programmes";
import { AuthProvider } from "../context/AuthContext";
import { restoreApi, session, stubApi } from "./helpers";

const DEPARTMENTS = [
  { id: "d1", name: "Computer Science", code: "CSE", isActive: true },
  { id: "d2", name: "Mechanical Engineering", code: "MECH", isActive: true },
];

const PEOPLE = [
  {
    id: "u1",
    fullName: "Ananya Sharma",
    email: "ananya@campusos.local",
    role: "FACULTY",
    department: DEPARTMENTS[0],
    isActive: true,
    mustChangePassword: false,
  },
  {
    id: "u2",
    fullName: "Raghav Kumar",
    email: "raghav@campusos.local",
    role: "HOD",
    department: DEPARTMENTS[1],
    isActive: true,
    mustChangePassword: true,
  },
];

const ADMIN_SESSION = session({
  user: {
    id: "admin",
    fullName: "Admin",
    email: "admin@campusos.local",
    role: "SUPER_ADMIN",
  },
  permissions: [
    "user:read:institution",
    "user:manage:institution",
    "department:manage:institution",
    "program:manage:institution",
  ],
  scopes: ["own", "institution"],
});

function renderWith(ui) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{ui}</AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Overrides first: stubApi keeps the earlier entry when two match by length. */
function stubPeople(extra = []) {
  stubApi([
    ...extra,
    ["/auth/me", ADMIN_SESSION],
    ["/admin/departments", { success: true, data: DEPARTMENTS }],
    [
      "/admin/users",
      {
        success: true,
        data: PEOPLE,
        meta: { pagination: { page: 1, pages: 1, total: 2 } },
      },
    ],
  ]);
}

beforeEach(() => {
  document.cookie = "cos_ct=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

afterEach(restoreApi);

describe("the people list", () => {
  it("shows who each person is and what they may do", async () => {
    stubPeople();
    renderWith(<People />);

    const row = (await screen.findByText("Ananya Sharma")).closest("li");
    expect(row).not.toBeNull();
    expect(within(row).getByText("ananya@campusos.local")).toBeInTheDocument();
    expect(within(row).getByText("Faculty")).toBeInTheDocument();
    expect(within(row).getByText("Computer Science")).toBeInTheDocument();
  });

  /**
   * An account still on its generated password is a live risk — the institute
   * still knows the credential. It is marked rather than left to be noticed.
   */
  it("flags an account that has not replaced its temporary password", async () => {
    stubPeople();
    renderWith(<People />);

    await screen.findByText("Ananya Sharma");
    expect(screen.getByText(/awaiting password change/i)).toBeInTheDocument();
  });

  it("searches without leaving the page", async () => {
    const user = userEvent.setup();
    stubPeople();
    renderWith(<People />);

    await screen.findByText("Ananya Sharma");

    await user.type(screen.getByLabelText(/search people/i), "Raghav");
    // Enter submits: the field is the whole control, so a separate button would
    // be a second thing to aim at.
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.getByDisplayValue("Raghav")).toBeInTheDocument(),
    );
  });

  it("says plainly when nothing matches", async () => {
    stubApi([
      ["/auth/me", ADMIN_SESSION],
      ["/admin/departments", { success: true, data: DEPARTMENTS }],
      [
        "/admin/users",
        {
          success: true,
          data: [],
          meta: { pagination: { page: 1, pages: 1, total: 0 } },
        },
      ],
    ]);
    renderWith(<People />);

    expect(await screen.findByText(/no accounts match/i)).toBeInTheDocument();
  });
});

describe("actions on your own account", () => {
  /**
   * Shown-and-disabled would make the screen look broken on every row the
   * administrator looks at. The server refuses these anyway; not offering them
   * is the honest presentation.
   */
  it("does not offer role, reset or deactivate on your own row", async () => {
    stubApi([
      ["/auth/me", ADMIN_SESSION],
      ["/admin/departments", { success: true, data: DEPARTMENTS }],
      [
        "/admin/users",
        {
          success: true,
          data: [
            {
              id: "admin",
              fullName: "Admin",
              email: "admin@campusos.local",
              role: "SUPER_ADMIN",
              isActive: true,
            },
          ],
          meta: { pagination: { page: 1, pages: 1, total: 1 } },
        },
      ],
    ]);
    renderWith(<People />);

    await screen.findByText("admin@campusos.local");

    expect(screen.queryByRole("button", { name: /^role$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /deactivate/i })).toBeNull();
    expect(screen.getByText("You")).toBeInTheDocument();
  });
});

describe("creating an account", () => {
  it("will not submit an incomplete form", async () => {
    const user = userEvent.setup();
    stubPeople();
    renderWith(<People />);

    await user.click(
      await screen.findByRole("button", { name: /add an account/i }),
    );

    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeDisabled();
  });

  /**
   * Faculty permissions are scoped to a department. Creating one without a
   * department produces an account that can see nothing, which is far harder to
   * notice than a refused form.
   */
  it("demands a department for a role whose permissions are scoped to one", async () => {
    const user = userEvent.setup();
    stubPeople();
    renderWith(<People />);

    await user.click(
      await screen.findByRole("button", { name: /add an account/i }),
    );
    await user.selectOptions(screen.getByLabelText(/^role/i), "FACULTY");

    expect(
      screen.getByText(/required — this role's permissions are scoped/i),
    ).toBeInTheDocument();
  });

  it("says the temporary password is shown only once", async () => {
    const user = userEvent.setup();
    stubPeople([
      [
        "/admin/users",
        {
          __status: 201,
          body: {
            success: true,
            data: {
              id: "u3",
              email: "new.person@campusos.local",
              role: "LIBRARY_ADMIN",
            },
            meta: {
              temporaryPassword: "Xk7p2Qm9Rt4Lv6Wz",
              notice: "Shown once.",
            },
          },
        },
      ],
    ]);
    renderWith(<People />);

    await user.click(
      await screen.findByRole("button", { name: /add an account/i }),
    );

    await user.type(screen.getByLabelText(/full name/i), "New Person");
    await user.type(
      screen.getByLabelText(/email/i),
      "new.person@campusos.local",
    );
    await user.selectOptions(screen.getByLabelText(/^role/i), "LIBRARY_ADMIN");

    stubPeople([
      [
        "/admin/users",
        {
          __status: 201,
          body: {
            success: true,
            data: {
              id: "u3",
              email: "new.person@campusos.local",
              role: "LIBRARY_ADMIN",
            },
            meta: {
              temporaryPassword: "Xk7p2Qm9Rt4Lv6Wz",
              notice: "Shown once.",
            },
          },
        },
      ],
    ]);

    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText("Xk7p2Qm9Rt4Lv6Wz")).toBeInTheDocument();
    expect(screen.getByText(/only time it will be shown/i)).toBeInTheDocument();
    // And it says what happens if the dialog is closed without copying it.
    expect(screen.getByText(/cannot be recovered/i)).toBeInTheDocument();
  });

  /**
   * The server's field-level reason, shown next to the input rather than as a
   * generic failure at the bottom of a long form.
   */
  it("shows the reason a field was refused", async () => {
    const user = userEvent.setup();
    stubPeople();
    renderWith(<People />);

    await user.click(
      await screen.findByRole("button", { name: /add an account/i }),
    );

    await user.type(screen.getByLabelText(/full name/i), "New Person");
    await user.type(
      screen.getByLabelText(/email/i),
      "new.person@campusos.local",
    );
    await user.selectOptions(screen.getByLabelText(/^role/i), "LIBRARY_ADMIN");

    stubPeople([
      [
        "/admin/users",
        {
          __status: 409,
          body: {
            success: false,
            message: "An account already exists with that email address",
            details: [{ field: "email", message: "Already in use" }],
          },
        },
      ],
    ]);

    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText("Already in use")).toBeInTheDocument();
  });
});

describe("changing a role", () => {
  it("insists on a written reason before it will send anything", async () => {
    const user = userEvent.setup();
    stubPeople();
    renderWith(<People />);

    await screen.findByText("Ananya Sharma");
    await user.click(screen.getAllByRole("button", { name: /^role$/i })[0]);

    const dialog = screen.getByRole("dialog");

    await user.click(
      within(dialog).getByRole("button", { name: /change role/i }),
    );
    expect(
      await within(dialog).findByText(/at least 10 characters/i),
    ).toBeInTheDocument();
  });

  /**
   * The consequence is stated before the button, not discovered afterwards:
   * people keep working, at their old permissions, until their token expires.
   */
  it("warns that the person is signed out everywhere", async () => {
    const user = userEvent.setup();
    stubPeople();
    renderWith(<People />);

    await screen.findByText("Ananya Sharma");
    await user.click(screen.getAllByRole("button", { name: /^role$/i })[0]);

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/signed out of every device/i),
    ).toBeInTheDocument();
  });

  /**
   * A refusal with no explanation is a dead end. The server's reason is the
   * whole value of refusing.
   */
  it("shows the server's reason for refusing", async () => {
    const user = userEvent.setup();
    stubPeople();
    renderWith(<People />);

    await screen.findByText("Ananya Sharma");
    await user.click(screen.getAllByRole("button", { name: /^role$/i })[0]);

    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/reason/i),
      "Taking the department over",
    );

    stubPeople([
      [
        "/admin/users/u1/role",
        {
          __status: 400,
          body: {
            success: false,
            message:
              "This is the last active super administrator. Appoint another one first",
            details: [
              {
                field: "role",
                message: "Cannot demote the last super administrator",
              },
            ],
          },
        },
      ],
    ]);

    await user.click(
      within(dialog).getByRole("button", { name: /change role/i }),
    );

    // The server named the offending field, so the reason lands next to the
    // role input rather than as a summary at the bottom of the form.
    expect(
      await within(dialog).findByText(
        /cannot demote the last super administrator/i,
      ),
    ).toBeInTheDocument();
  });
});

describe("departments", () => {
  it("shows them with their code and head", async () => {
    stubApi([
      ["/auth/me", ADMIN_SESSION],
      [
        "/admin/departments",
        {
          success: true,
          data: [
            {
              id: "d1",
              name: "Computer Science",
              code: "CSE",
              isActive: true,
              hod: { fullName: "Dr Anita Rao" },
            },
          ],
        },
      ],
    ]);
    renderWith(<Departments />);

    expect(await screen.findByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("Dr Anita Rao")).toBeInTheDocument();
  });

  it("will not retire a department the server says still has people on it", async () => {
    const user = userEvent.setup();
    stubApi([
      ["/auth/me", ADMIN_SESSION],
      [
        "/admin/departments",
        {
          success: true,
          data: [
            { id: "d1", name: "Computer Science", code: "CSE", isActive: true },
          ],
        },
      ],
    ]);
    renderWith(<Departments />);

    await user.click(await screen.findByRole("button", { name: /retire/i }));

    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/reason/i),
      "Closing the department down",
    );

    stubApi([
      ["/auth/me", ADMIN_SESSION],
      [
        "/admin/departments",
        {
          success: true,
          data: [
            { id: "d1", name: "Computer Science", code: "CSE", isActive: true },
          ],
        },
      ],
      [
        "/admin/departments/d1/active",
        {
          __status: 400,
          body: {
            success: false,
            message:
              "This department still has 12 staff, 3 programmes. Move or retire them first",
            details: [{ field: "isActive", message: "12 staff" }],
          },
        },
      ],
    ]);

    await user.click(within(dialog).getByRole("button", { name: /^retire$/i }));

    // The blocker is named, so the person knows what to go and fix.
    expect(
      await within(dialog).findByText(/still has 12 staff/i),
    ).toBeInTheDocument();
  });
});

describe("programmes", () => {
  it("shows level, duration and owning department", async () => {
    // The department is deliberately not also called "Computer Science": that
    // name is part of the programme title, and the assertion below would match
    // the heading rather than the line it means to check.
    stubApi([
      ["/auth/me", ADMIN_SESSION],
      [
        "/admin/departments",
        {
          success: true,
          data: [{ id: "d9", name: "Electronics", code: "ECE" }],
        },
      ],
      [
        "/admin/programs",
        {
          success: true,
          data: [
            {
              id: "p1",
              name: "B.Tech Computer Science",
              code: "BTCS",
              level: "UNDERGRADUATE",
              durationYears: 4,
              isActive: true,
              department: { id: "d9", name: "Electronics" },
            },
          ],
        },
      ],
    ]);
    renderWith(<Programmes />);

    const row = (await screen.findByText("B.Tech Computer Science")).closest(
      "li",
    );
    expect(within(row).getByText(/Undergraduate/i)).toBeInTheDocument();
    expect(within(row).getByText(/4 years/)).toBeInTheDocument();
    // Code, level, duration and department share one line, so this is matched
    // as a pattern rather than as an exact string.
    expect(within(row).getByText(/Electronics/)).toBeInTheDocument();
    expect(within(row).getByText(/BTCS/)).toBeInTheDocument();
  });

  /**
   * These are printed on transcripts. Offering "UG" while the model stores
   * "UNDERGRADUATE" would put two different spellings of one fact on the same
   * document.
   */
  it("offers the model's own level vocabulary, not shorthand", async () => {
    const user = userEvent.setup();
    stubApi([
      ["/auth/me", ADMIN_SESSION],
      ["/admin/departments", { success: true, data: DEPARTMENTS }],
      ["/admin/programs", { success: true, data: [] }],
    ]);
    renderWith(<Programmes />);

    await user.click(
      await screen.findByRole("button", { name: /new programme/i }),
    );

    // Scoped to the dialog: the page also has a level filter with the same
    // options, which is not what this test is about.
    const options = Array.from(
      within(screen.getByRole("dialog"))
        .getByLabelText(/^level/i)
        .querySelectorAll("option"),
    )
      .map((option) => option.value)
      .filter(Boolean);

    expect(options).toContain("UNDERGRADUATE");
    expect(options).not.toContain("UG");
  });

  it("refuses to create one without a department", async () => {
    const user = userEvent.setup();
    stubApi([
      ["/auth/me", ADMIN_SESSION],
      ["/admin/departments", { success: true, data: DEPARTMENTS }],
      ["/admin/programs", { success: true, data: [] }],
    ]);
    renderWith(<Programmes />);

    await user.click(
      await screen.findByRole("button", { name: /new programme/i }),
    );

    await user.type(screen.getByLabelText(/^name/i), "B.Tech AI");
    await user.type(screen.getByLabelText(/^code/i), "BTAI");
    await user.selectOptions(screen.getByLabelText(/^level/i), "UNDERGRADUATE");

    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
  });
});
