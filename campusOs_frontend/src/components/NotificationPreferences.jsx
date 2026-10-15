import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bell, Check, Loader2 } from "lucide-react";

import { apiPatch } from "../api/client";

/**
 * Notification preferences.
 *
 * ## Five switches, not fourteen
 *
 * Fourteen notification types is a settings page nobody reads. Grouped by
 * subject — requests, complaints, certificates, finance, announcements —
 * somebody can express "don't interrupt me about money" in one tap.
 *
 * ## Muted still delivers, and the page says so
 *
 * Turning a category off stops the badge, not the message. A student who mutes
 * finance and then misses "your refund was processed" has been harmed by a
 * setting meant to stop noise — so everything still arrives and still appears in
 * the list, and the switch is labelled to say which one it is.
 *
 * Saving on each change rather than behind a Save button: there is no partial
 * state to lose, and a preference that needs a second click to take effect is a
 * preference people stop trusting.
 */

const CATEGORIES = [
  [
    "requests",
    "Requests",
    "Assigned to you, status changes, and things waiting on you.",
  ],
  [
    "complaints",
    "Complaints",
    "Status changes and escalations on complaints you raised.",
  ],
  [
    "certificates",
    "Certificates",
    "Applications moving, and the moment one is issued.",
  ],
  ["finance", "Finance", "Invoices, payments and refunds."],
  ["announcements", "Announcements", "Notices from the college."],
];

export default function NotificationPreferences({ preferences, onChange }) {
  const [values, setValues] = useState(preferences);
  const [savedAt, setSavedAt] = useState(null);

  /*
   * Resync when the server sends different preferences.
   *
   * Done during render rather than in an effect: an effect that calls setState
   * synchronously forces a second render pass to do work the first pass could
   * have done, and React's own lint rule flags it. Tracking what we last synced
   * from is the documented way to adjust state when a prop changes.
   */
  const [syncedFrom, setSyncedFrom] = useState(preferences);
  if (preferences !== syncedFrom) {
    setSyncedFrom(preferences);
    setValues(preferences);
  }

  const save = useMutation({
    mutationFn: (next) => apiPatch("/profile/notification-preferences", next),
    onSuccess: (response) => {
      setValues(response.data.preferences);
      setSavedAt(new Date().toISOString());
      onChange?.(response.data.preferences);
    },
  });

  if (!values) return null;

  const toggle = (key, next) => {
    const updated = { ...values, [key]: next };
    setValues(updated);
    save.mutate(updated);
  };

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-ink-100/80 dark:divide-ink-700/50">
        {CATEGORIES.map(([key, label, description]) => {
          const on = values[key] !== false;
          const id = `notify-${key}`;

          return (
            <li key={key} className="flex items-start gap-4 py-3.5">
              {/*
                A real checkbox, not a styled div. It is keyboard reachable,
                announced with its label, and toggled with Space, all of which a
                button pretending to be a switch is not.
              */}
              <input
                id={id}
                type="checkbox"
                checked={on}
                onChange={(event) => toggle(key, event.target.checked)}
                disabled={save.isPending}
                className="mt-1 size-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-600 disabled:opacity-60 dark:border-ink-600"
              />

              <div className="min-w-0 flex-1">
                <label
                  htmlFor={id}
                  className="block text-sm font-medium text-ink-900 dark:text-ink-100"
                >
                  {label}
                </label>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                  {description}
                </p>
              </div>

              <span
                className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ring-1 ring-inset ${
                  on
                    ? "bg-brand-100 text-brand-800 ring-brand-600/20 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-400/25"
                    : "bg-ink-100 text-ink-600 ring-ink-300/60 dark:bg-ink-200/40 dark:text-ink-300 dark:ring-ink-500/30"
                }`}
              >
                {on ? "Badges" : "Muted"}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4 dark:border-ink-700/50">
        <p className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400">
          <Bell className="size-3.5" aria-hidden="true" />
          Muting stops the badge. Nothing is ever hidden from you.
        </p>

        <p
          role="status"
          aria-live="polite"
          className="flex items-center gap-1.5 text-xs text-brand-700 dark:text-brand-300"
        >
          {save.isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : save.isError ? (
            <span className="text-red-700 dark:text-red-300">
              {save.error?.message}
            </span>
          ) : savedAt ? (
            <>
              <Check className="size-3.5" aria-hidden="true" />
              Saved
            </>
          ) : null}
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <label
            htmlFor="notify-unread-badge"
            className="block text-sm font-medium text-ink-900 dark:text-ink-100"
          >
            Show an unread count on the bell
          </label>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
            Switch this off to silence the bell entirely. Notifications still
            arrive in the list.
          </p>
        </div>

        <input
          id="notify-unread-badge"
          type="checkbox"
          checked={values.unreadBadge !== false}
          onChange={(event) => toggle("unreadBadge", event.target.checked)}
          disabled={save.isPending}
          className="size-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-600 disabled:opacity-60 dark:border-ink-600"
        />
      </div>
    </div>
  );
}
