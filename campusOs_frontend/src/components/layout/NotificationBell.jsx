import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";

import { apiGet, apiPost } from "../../api/client";
import { formatRelative, humanise } from "../../lib/format";
import { EmptyState } from "../ui/States";

/**
 * The notification bell.
 *
 * ## Closing on Escape and on outside click
 *
 * A popover that only closes on its trigger is a keyboard trap: a user who
 * opens it with Enter has no way back out except Shift+Tab. Escape closes it and
 * returns focus to the button, which is the behaviour the ARIA pattern asks for.
 *
 * ## The count is not the list
 *
 * A badge showing "12" next to a panel holding five items invites the reading
 * that five have gone missing. The panel says what the number means: unread out
 * of everything received.
 */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const buttonRef = useRef(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const unread = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => apiGet("/notifications/unread-count"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const list = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => apiGet("/notifications?limit=8"),
    enabled: open,
  });

  const markRead = useMutation({
    mutationFn: (id) => apiPost(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => apiPost("/notifications/read-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // Escape closes and returns focus, so keyboard users are not stranded.
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    const onPointerDown = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const count = unread.data?.data?.unread ?? 0;

  const openItem = (notification) => {
    if (!notification.isRead) markRead.mutate(notification.id);
    setOpen(false);
    if (notification.link) navigate(notification.link);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          count > 0 ? `Notifications, ${count} unread` : "Notifications"
        }
        className="relative rounded-lg p-2 text-ink-600 hover:bg-ink-100 dark:hover:bg-ink-200/50"
      >
        <Bell className="size-5" aria-hidden="true" />
        {count > 0 && (
          <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-30 mt-2 w-88 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-white/95 dark:bg-surface shadow-pop ring-1 ring-ink-200/80 dark:ring-ink-600 backdrop-blur-xl"
        >
          <div className="flex items-center justify-between border-b border-ink-100 dark:border-ink-700/50 px-4 py-2.5">
            <div>
              <p className="text-sm font-semibold text-ink-900">
                Notifications
              </p>
              <p className="text-xs text-ink-500 dark:text-ink-400">
                {count > 0 ? `${count} unread` : "All caught up"}
              </p>
            </div>
            {count > 0 && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-500/20 disabled:text-ink-400"
              >
                <CheckCheck className="size-3.5" aria-hidden="true" />
                Mark all read
              </button>
            )}
          </div>

          <ul className="max-h-96 divide-y divide-ink-100 overflow-y-auto">
            {list.isLoading && (
              <li className="px-4 py-6 text-center text-xs text-ink-500 dark:text-ink-400">
                Loading…
              </li>
            )}

            {list.isError && (
              <li className="px-4 py-6 text-center text-xs text-red-600 dark:text-red-400">
                Could not load notifications.
              </li>
            )}

            {list.data?.data?.length === 0 && (
              <li className="px-4 py-2">
                <EmptyState
                  icon={Bell}
                  title="Nothing yet"
                  description="Updates to your requests, complaints and payments will appear here."
                />
              </li>
            )}

            {list.data?.data?.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => openItem(notification)}
                  className={`w-full px-4 py-3 text-left hover:bg-ink-50 dark:hover:bg-ink-200/40 ${
                    notification.isRead
                      ? ""
                      : "bg-brand-50/40 dark:bg-brand-500/15"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!notification.isRead && (
                      <span
                        aria-label="Unread"
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink-800">
                        {notification.title}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                        {notification.body}
                      </p>
                      <p className="mt-1 text-[11px] text-ink-400 dark:text-ink-500">
                        {humanise(notification.type)} ·{" "}
                        {formatRelative(notification.createdAt)}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
