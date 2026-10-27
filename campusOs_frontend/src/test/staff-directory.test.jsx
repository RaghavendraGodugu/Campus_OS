import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import StaffDirectory from "../pages/StaffDirectory";
import { restoreApi, session, stubApi, stubApiRecording } from "./helpers";
import { AuthProvider } from "../context/AuthContext";

const DIRECTORY = {
  success: true,
  data: [
    {
      id: "u-rao",
      fullName: "Anand Rao",
      role: "FACULTY",
      designation: "Associate Professor",
      expertise: ["Machine Learning", "Distributed Systems"],
      department: "dept-cse",
    },
    {
      id: "u-verma",
      fullName: "Joseph Verma",
      role: "HOSTEL_ADMIN",
      designation: null,
      expertise: [],
      department: null,
    },
  ],
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter>
          <StaffDirectory />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  document.cookie = "cos_ct=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

afterEach(restoreApi);

describe("StaffDirectory", () => {
  it("lists the people the server returned, with designation and skills", async () => {
    stubApi([
      ["/auth/me", session()],
      ["/notifications", { success: true, data: { items: [], unread: 0 } }],
      [/\/directory\/staff(\?.*)?$/, DIRECTORY],
    ]);
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Anand Rao" }),
    ).toBeVisible();
    expect(screen.getByText(/Associate Professor/)).toBeVisible();
    expect(screen.getByText("Machine Learning")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Joseph Verma" })).toBeVisible();
  });

  it("sends the typed query and the role filter to the server", async () => {
    const { requests } = stubApiRecording([
      ["/auth/me", session()],
      ["/notifications", { success: true, data: { items: [], unread: 0 } }],
      [/\/directory\/staff(\?.*)?$/, DIRECTORY],
    ]);
    renderPage();

    await screen.findByRole("heading", { name: "Anand Rao" });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Search the staff directory"), "Rao");
    await user.selectOptions(
      screen.getByLabelText("Filter by role"),
      "FACULTY",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(requests.some((r) => r.url.includes("/directory/staff"))).toBe(
        true,
      );
    });
    const search = requests
      .map((r) => r.url)
      .find((url) => url.includes("q=Rao"));
    expect(search).toBeTruthy();
    expect(search).toContain("role=FACULTY");
  });

  it("shows a kind empty state when nobody matches", async () => {
    stubApi([
      ["/auth/me", session()],
      ["/notifications", { success: true, data: { items: [], unread: 0 } }],
      [/\/directory\/staff(\?.*)?$/, { success: true, data: [] }],
    ]);
    renderPage();
    expect(await screen.findByText("No matches")).toBeVisible();
  });

  it("never shows contact fields even if a careless server ever sent them", async () => {
    const leaky = {
      success: true,
      data: [
        { ...DIRECTORY.data[0], email: "rao@campusos.local", phone: "+911" },
      ],
    };
    stubApi([
      ["/auth/me", session()],
      ["/notifications", { success: true, data: { items: [], unread: 0 } }],
      [/\/directory\/staff(\?.*)?$/, leaky],
    ]);
    renderPage();
    await screen.findByRole("heading", { name: "Anand Rao" });
    expect(screen.queryByText("rao@campusos.local")).toBeNull();
    expect(screen.queryByText("+911")).toBeNull();
  });
});
