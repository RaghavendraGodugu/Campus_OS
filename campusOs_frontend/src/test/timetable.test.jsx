import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, afterEach } from "vitest";

import Timetable from "../pages/Timetable";
import { stubApiRecording, restoreApi } from "./helpers";

const TERM = {
  id: "term-1",
  name: "Term-2",
  code: "CODE-RED",
  academicYear: "2026-27",
  startsOn: "2026-10-29",
  endsOn: "2026-12-13",
  status: "OPEN",
  isCurrent: true,
};

function renderTimetable() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Timetable />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubTimetable() {
  return stubApiRecording([
    [
      "/timetable/staff",
      {
        success: true,
        data: {
          staff: [{ _id: "faculty-1", fullName: "Faculty(ICP)" }],
        },
      },
    ],
    [
      "/timetable",
      {
        success: true,
        data: { term: TERM, entries: [] },
        meta: { canManage: true },
      },
    ],
    [
      "/subjects",
      {
        success: true,
        data: {
          subjects: [
            {
              id: "subject-1",
              code: "CS001",
              name: "Introduction to Programming",
              semester: 1,
            },
          ],
        },
      },
    ],
    [
      "/rooms",
      {
        success: true,
        data: {
          rooms: [{ id: "room-1", block: "Classroom 2A", name: "2A" }],
        },
      },
    ],
  ]);
}

describe("schedule class dialog", () => {
  afterEach(() => restoreApi());

  it("submits a selected date as a one-off class", async () => {
    const network = stubTimetable();
    renderTimetable();

    await screen.findByText(/nothing scheduled yet/i);
    await userEvent.click(
      screen.getAllByRole("button", { name: /add class/i })[0],
    );

    await screen.findByRole("option", { name: /CS001/ });
    await userEvent.selectOptions(
      screen.getByLabelText(/subject/i),
      "subject-1",
    );
    await userEvent.selectOptions(
      screen.getByLabelText(/faculty/i),
      "faculty-1",
    );
    await userEvent.selectOptions(screen.getByLabelText(/room/i), "room-1");
    await userEvent.selectOptions(screen.getByLabelText(/repeats/i), "ONE_OFF");
    fireEvent.change(screen.getByLabelText(/class date/i), {
      target: { value: "2026-11-02" },
    });

    await userEvent.click(screen.getByRole("button", { name: /^schedule$/i }));

    await waitFor(() => {
      expect(
        network.requests.some(
          (request) =>
            request.method === "post" && request.path.endsWith("/timetable"),
        ),
      ).toBe(true);
    });

    const request = network.requests.find(
      (item) => item.method === "post" && item.path.endsWith("/timetable"),
    );

    expect(request.body).toMatchObject({
      term: "term-1",
      subject: "subject-1",
      faculty: "faculty-1",
      room: "room-1",
      startsOn: "2026-11-02",
      repeatsWeekly: false,
      dayOfWeek: 1,
      startMinute: 540,
      endMinute: 600,
    });
  });
});
