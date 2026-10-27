import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, afterEach, vi } from "vitest";

import ComposeAnnouncement from "../pages/ComposeAnnouncement";
import { stubApiRecording, restoreApi } from "./helpers";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderCompose() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ComposeAnnouncement />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ComposeAnnouncement", () => {
  afterEach(() => {
    restoreApi();
    mockNavigate.mockReset();
  });

  it("validates title and body before submitting", async () => {
    const network = stubApiRecording([
      ["/departments", { success: true, data: [] }],
    ]);

    renderCompose();

    const postButton = screen.getByRole("button", { name: /post notice/i });
    fireEvent.click(postButton);

    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(screen.getByText(/body is required/i)).toBeInTheDocument();

    // No POST requests made
    const postRequests = network.requests.filter((r) => r.method === "post");
    expect(postRequests.length).toBe(0);
  });

  it("allows selecting and removing an image", async () => {
    stubApiRecording([["/departments", { success: true, data: [] }]]);

    // Mock URL.createObjectURL and URL.revokeObjectURL
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:preview-url");
    URL.revokeObjectURL = vi.fn();

    try {
      renderCompose();

      const file = new File(["dummy content"], "test-notice.png", {
        type: "image/png",
      });
      const fileInput = document.getElementById("announcement-image");
      fireEvent.change(fileInput, { target: { files: [file] } });

      expect(screen.getByText("test-notice.png")).toBeInTheDocument();
      expect(
        screen.getByAltText(/preview of the image chosen/i),
      ).toBeInTheDocument();

      const removeBtn = screen.getByRole("button", { name: /remove image/i });
      fireEvent.click(removeBtn);

      expect(screen.getByText(/choose a jpeg or png/i)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /remove image/i }),
      ).not.toBeInTheDocument();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("rejects an oversized image before it reaches the server", async () => {
    stubApiRecording([["/departments", { success: true, data: [] }]]);

    renderCompose();

    const file = new File(["not really an image"], "huge.png", {
      type: "image/png",
    });
    Object.defineProperty(file, "size", { value: 5 * 1024 * 1024 + 1 });

    fireEvent.change(document.getElementById("announcement-image"), {
      target: { files: [file] },
    });

    expect(
      await screen.findByText(/that image is over 5 mb/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByAltText(/preview of the image chosen/i),
    ).not.toBeInTheDocument();
  });

  it("submits announcement payload without image in JSON, then uploads image using reference", async () => {
    const user = userEvent.setup();
    const network = stubApiRecording([
      ["/departments", { success: true, data: [] }],
      [
        "/announcements",
        {
          success: true,
          data: {
            announcement: {
              id: "672a00000000000000000001",
              reference: "AN-2026-000099",
              title: "Campus Library Renovations",
              body: "The library will be closed this weekend for system upgrades.",
              priority: "NORMAL",
              pinned: false,
              audience: { scope: "ALL" },
            },
          },
        },
      ],
      [
        "/announcements/AN-2026-000099/image",
        {
          success: true,
          data: { attachment: { mimeType: "image/png" } },
        },
      ],
    ]);

    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:preview-url");
    URL.revokeObjectURL = vi.fn();

    try {
      renderCompose();

      const titleInput = screen.getByLabelText(/title/i);
      const bodyInput = screen.getByLabelText(/body/i);

      await user.type(titleInput, "Campus Library Renovations");
      await user.type(
        bodyInput,
        "The library will be closed this weekend for system upgrades.",
      );

      const file = new File(["dummy image"], "notice.png", {
        type: "image/png",
      });
      const fileInput = document.getElementById("announcement-image");
      fireEvent.change(fileInput, { target: { files: [file] } });

      const postButton = screen.getByRole("button", { name: /post notice/i });
      fireEvent.click(postButton);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          "/announcements/AN-2026-000099",
        );
      });

      const createNoticeReq = network.requests.find(
        (r) => r.method === "post" && r.path.endsWith("/announcements"),
      );
      expect(createNoticeReq).toBeDefined();
      expect(createNoticeReq.body.title).toBe("Campus Library Renovations");
      expect(createNoticeReq.body.body).toBe(
        "The library will be closed this weekend for system upgrades.",
      );
      // Ensure imageFile is NOT serialized as an unrecognized property in JSON payload
      expect(createNoticeReq.body.image).toBeUndefined();
      expect(createNoticeReq.body.imageFile).toBeUndefined();

      const imageReq = network.requests.find(
        (r) => r.method === "post" && r.path.includes("/image"),
      );
      expect(imageReq).toBeDefined();
      expect(imageReq.path).toContain("/announcements/AN-2026-000099/image");
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("displays server error message when announcement posting fails", async () => {
    const user = userEvent.setup();
    stubApiRecording([
      ["/departments", { success: true, data: [] }],
      [
        "/announcements",
        {
          __status: 403,
          body: {
            success: false,
            message: "You do not have permission to post announcements.",
          },
        },
      ],
    ]);

    renderCompose();

    const titleInput = screen.getByLabelText(/title/i);
    const bodyInput = screen.getByLabelText(/body/i);

    await user.type(titleInput, "Annual Sports Meet");
    await user.type(
      bodyInput,
      "Sports meet will be held on the college grounds next Saturday.",
    );

    const postButton = screen.getByRole("button", { name: /post notice/i });
    fireEvent.click(postButton);

    expect(
      await screen.findByText(
        /you do not have permission to post announcements/i,
      ),
    ).toBeInTheDocument();
  });
});
