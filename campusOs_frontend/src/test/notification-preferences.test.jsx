import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, afterEach, vi } from "vitest";

import NotificationPreferences from "../components/NotificationPreferences";
import { stubApi, restoreApi } from "./helpers";

/**
 * Notification preferences.
 *
 * The wording is the feature. A switch labelled only "Finance" invites someone
 * to read it as "turn off messages about money", which would be a promise the
 * server does not keep — so the panel says plainly that muting stops the badge
 * and hides nothing.
 */

const ALL_ON = {
  requests: true,
  complaints: true,
  certificates: true,
  finance: true,
  announcements: true,
  unreadBadge: true,
};

function renderPreferences(preferences = ALL_ON, onChange) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <NotificationPreferences preferences={preferences} onChange={onChange} />
    </QueryClientProvider>,
  );
}

describe("notification preferences", () => {
  afterEach(() => restoreApi());

  it("offers one switch per category, not one per notification type", async () => {
    stubApi([["/profile/notification-preferences", 200]]);
    renderPreferences();

    for (const label of [
      "Requests",
      "Complaints",
      "Certificates",
      "Finance",
      "Announcements",
    ]) {
      expect(await screen.findByLabelText(label)).toBeInTheDocument();
    }
  });

  it("says that muting hides nothing", async () => {
    // Without this sentence the switch reads as "turn off messages", and
    // somebody would then miss a refund they had expected to be told about.
    stubApi([["/profile/notification-preferences", 200]]);
    renderPreferences();

    expect(
      screen.getByText(/muting stops the badge\. nothing is ever hidden/i),
    ).toBeInTheDocument();
  });

  it("uses real checkboxes, so they are reachable and labelled", () => {
    // A styled div pretending to be a switch is not keyboard reachable and is
    // not announced with its label.
    stubApi([["/profile/notification-preferences", 200]]);
    renderPreferences();

    const finance = screen.getByLabelText("Finance");
    expect(finance).toHaveAttribute("type", "checkbox");
    expect(finance).toBeChecked();
  });

  it("shows a muted category as muted rather than merely unchecked", () => {
    stubApi([["/profile/notification-preferences", 200]]);
    renderPreferences({ ...ALL_ON, finance: false });

    const finance = screen.getByLabelText("Finance");
    expect(finance).not.toBeChecked();
    expect(screen.getByText("Muted")).toBeInTheDocument();
  });

  it("saves immediately on change, with no Save button to forget", async () => {
    stubApi([
      [
        "/profile/notification-preferences",
        { success: true, data: { preferences: { ...ALL_ON, finance: false } } },
      ],
    ]);

    const onChange = vi.fn();
    renderPreferences(ALL_ON, onChange);

    await userEvent.click(screen.getByLabelText("Finance"));

    // A preference that needs a second click to take effect is one people stop
    // trusting.
    await screen.findByText("Saved");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ finance: false }),
    );
  });

  it("offers a blanket bell switch, and says it does not stop delivery", () => {
    stubApi([["/profile/notification-preferences", 200]]);
    renderPreferences();

    expect(
      screen.getByLabelText(/unread count on the bell/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/notifications still arrive in the list/i),
    ).toBeInTheDocument();
  });
});
