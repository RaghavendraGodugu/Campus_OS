import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * A dialog.
 *
 * ## The parts a dialog has to get right, and why they are here
 *
 * A modal that merely looks modal is worse than one that behaves like a page,
 * because it traps focus without saying so and the keyboard user has no way out
 * that they can discover.
 *
 * - **Escape closes it.** Refusing Escape strands a keyboard user.
 * - **Focus moves in on open, and returns to the trigger on close.** Otherwise
 *   focus stays on a button that is now behind a backdrop, and the next Tab
 *   wanders into the page underneath.
 * - **Tab cycles within the dialog.** Implemented as a wrap, not a `inert`
 *   attribute, so it works in every browser this app supports.
 * - **The backdrop closes it on click** — but only a click that *starts* on the
 *   backdrop. Without that check, a drag that ends outside a text field
 *   dismisses the form and loses what was typed.
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}) {
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;

    // Focus the first control, not the panel itself: a screen reader announcing
    // only the panel's name leaves the user with no idea what is inside.
    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((node) => node.offsetParent !== null);

    const first = focusable()[0];
    (first ?? panelRef.current)?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) return;

      const firstItem = items[0];
      const lastItem = items[items.length - 1];

      // Wrapping in both directions. `preventDefault` on the edges is what
      // stops the browser tabbing out into the page behind the backdrop.
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      // Put the user back where they were, so the dialog does not silently
      // move their place in the page.
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-3xl",
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6">
      {/*
        Click-to-close is on this element, and the handler checks the event
        target. A click that starts inside the panel and is released on the
        backdrop should not dismiss the form.
      */}
      <div
        className="fixed inset-0 bg-brand-950/40 backdrop-blur-sm"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`surface-raised relative my-auto w-full ${widths[size]} animate-rise outline-none`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-200/70 dark:border-ink-700/60 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-ink-900 dark:text-ink-100">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500 dark:text-ink-400 dark:text-ink-500">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500 transition-colors hover:bg-ink-100 dark:hover:bg-ink-200/50 hover:text-ink-700 dark:text-ink-300"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="px-5 py-5 sm:px-6">{children}</div>

        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-ink-200/70 dark:border-ink-700/60 bg-ink-50/50 dark:bg-ink-100/30 px-5 py-4 sm:px-6">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
