import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, afterEach } from "vitest";

import AnnouncementDetail from "../pages/AnnouncementDetail";
import { stubApi, restoreApi } from "./helpers";

/**
 * The envelope trap.
 *
 * Two API shapes sit behind the same `apiGet`:
 *
 *   { success, data: { title, ... } }               — most endpoints
 *   { success, data: { announcement: { ... } } }    — announcements
 *
 * Reading `data.data` on the second shape does not throw. It yields an object
 * with no title, no body and no audience, and the page renders a blank notice
 * with no error anywhere. That is exactly what happened: the announcements
 * detail page showed "—" for every field while reporting itself healthy.
 */
function envelopeFor(reference) {
  return {
    success: true,
    message: "Announcement retrieved successfully",
    data: {
      announcement: {
        id: "6acfb7838d610490a78d4d08",
        reference,
        title: "Sports day poster",
        body: "Here is the poster for inter-college sports day next Friday.",
        priority: "NORMAL",
        pinned: false,
        audience: { scope: "ALL" },
        status: "PUBLISHED",
        publishedAt: "2026-10-14T17:12:31.063Z",
        author: { id: "u1", fullName: "DEMO Administrator" },
        hasAttachment: true,
        attachmentMimeType: "image/png",
        notifiedCount: 0,
      },
    },
  };
}

function renderAt(reference) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/announcements/${reference}`]}>
        <Routes>
          <Route
            path="/announcements/:reference"
            element={<AnnouncementDetail />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("announcement detail", () => {
  afterEach(() => {
    restoreApi();
  });

  it("reads the record out of the nested envelope", async () => {
    stubApi([["/announcements/AN-2026-000003", envelopeFor("AN-2026-000003")]]);

    renderAt("AN-2026-000003");

    // The title and the body are the proof. Without the extra `.announcement`
    // both are undefined and the page renders em-dashes instead.
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /sports day poster/i }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/inter-college sports day next Friday/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/AN-2026-000003/)).toBeInTheDocument();
  });

  it("renders an image attachment inline rather than as a download", async () => {
    stubApi([["/announcements/AN-2026-000004", envelopeFor("AN-2026-000004")]]);

    renderAt("AN-2026-000004");

    const image = await screen.findByRole("img", {
      name: /image attached to the notice/i,
    });
    // Straight at the endpoint: it authenticates and applies the audience rule,
    // and there is no object URL whose lifetime has to be managed.
    expect(image).toHaveAttribute(
      "src",
      "/api/v1/announcements/AN-2026-000004/attachment",
    );

    // An image is shown, not offered as a file to download.
    expect(
      screen.queryByRole("button", { name: /download attachment/i }),
    ).not.toBeInTheDocument();
  });

  it("offers a retry when the image fails to load", async () => {
    stubApi([["/announcements/AN-2026-000005", envelopeFor("AN-2026-000005")]]);

    renderAt("AN-2026-000005");

    const image = await screen.findByRole("img", {
      name: /image attached to the notice/i,
    });
    fireEvent.error(image);

    expect(
      await screen.findByText(/attached image could not be loaded/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() =>
      expect(
        screen.getByRole("img", {
          name: /image attached to the notice/i,
        }),
      ).toHaveAttribute(
        "src",
        "/api/v1/announcements/AN-2026-000005/attachment?retry=1",
      ),
    );
  });
});
