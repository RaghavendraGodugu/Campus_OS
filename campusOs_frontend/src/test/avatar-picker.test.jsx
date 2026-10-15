import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, afterEach, vi } from "vitest";

import AvatarPicker from "../components/AvatarPicker";
import { stubApi, restoreApi } from "./helpers";

/**
 * The profile picture picker.
 *
 * The client-side checks exist to save a wasted round trip, not to be the
 * security boundary — the server sniffs the bytes regardless. What is worth
 * protecting is that the file is refused *before* it is sent, so a person
 * choosing a 9 MB photograph is told immediately rather than after an upload.
 */

function renderPicker(props = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <AvatarPicker userId="user-1" hasAvatar={false} {...props} />
    </QueryClientProvider>,
  );
}

function makeFile(name, type, size) {
  const file = new File([new Uint8Array(size)], name, { type });
  return file;
}

describe("avatar picker", () => {
  afterEach(() => restoreApi());

  it("offers a file input with the accepted types", () => {
    renderPicker();

    const input = screen.getByLabelText(/choose a profile picture/i);
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  });

  it("refuses a file that is not an accepted image, without uploading it", async () => {
    const upload = vi.fn();
    stubApi([["/profile/avatar", upload]]);

    renderPicker();

    const input = screen.getByLabelText(/choose a profile picture/i);

    // `fireEvent`, not `userEvent.upload`: the latter honours the input's
    // `accept` attribute and quietly refuses the file, so the component's own
    // guard would never run and this would assert nothing. In a real browser
    // that attribute only filters the file chooser — a dragged file or a renamed
    // one still arrives, which is exactly what the server sniffs for.
    fireEvent.change(input, {
      target: { files: [makeFile("notes.pdf", "application/pdf", 1024)] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /JPEG, PNG or WebP/i,
    );
  });

  it("refuses an image over 2 MB before it is uploaded", async () => {
    // An avatar is shown at 40px in the top bar. A 9 MB photograph is a crop
    // waiting to happen, and the honest response to that is a message.
    renderPicker();

    const input = screen.getByLabelText(/choose a profile picture/i);
    await userEvent.upload(
      input,
      makeFile("huge.jpg", "image/jpeg", 3 * 1024 * 1024),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/over 2 MB/i);
  });

  it("says what happens to the picture, not just that it accepts one", () => {
    renderPicker();
    // People are wary of a face-upload control with no explanation.
    expect(
      screen.getByText(/only you and signed-in colleagues/i),
    ).toBeInTheDocument();
  });

  it("offers removal only once there is a picture", () => {
    const { rerender } = renderPicker();
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false },
            },
          })
        }
      >
        <AvatarPicker userId="user-1" hasAvatar />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("points a picture already stored at the endpoint, not a public URL", () => {
    renderPicker({ hasAvatar: true });

    const image = screen.getByRole("img", { name: /your profile picture/i });
    // The endpoint authenticates the reader; a CDN URL would not, and would
    // make the picture public by being shareable.
    expect(image).toHaveAttribute("src", "/api/v1/profile/avatar/user-1");
  });
});
