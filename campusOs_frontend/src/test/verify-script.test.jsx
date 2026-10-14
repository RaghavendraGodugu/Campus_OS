/**
 * The browser sweep's error detection, tested.
 *
 * `scripts/verify-roles.mjs` once reported a page as PASS while it was displaying
 * an error: the profile route 404'd, the page said "Profile not available — Route
 * GET /api/v1/profile does not exist", and the script looked for words that were
 * not on the page. Widening the word list was worse — "not available" turned out
 * to be an ordinary value in the audit log, and a healthy page was reported as
 * broken.
 *
 * So the sweep now asks the DOM for `role="alert"`. That attribute is set by
 * `ErrorState` and by nothing else, which means this decision cannot drift as
 * pages are renamed or reworded.
 *
 * These tests exist to prove the sweep can still fail. A verification script
 * that cannot fail is worse than no script, because it gets believed.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { ErrorState, EmptyState, Loading } from "../components/ui/States";
import { SkeletonList, SkeletonRegion } from "../components/ui/Skeleton";

/** The selector the sweep runs in the page, copied from the script. */
const ERROR_SELECTOR = 'main [role="alert"], [role="alert"][class*="red"]';

/**
 * What the browser sweep does with a rendered page.
 *
 * `textContent` stands in for `innerText` because jsdom does not implement
 * `innerText`. Both work in Chrome, which is where the sweep actually runs; only
 * the presence of the matched element matters here, not its exact text.
 */
function classify(container) {
  const alerts = Array.from(container.querySelectorAll(ERROR_SELECTOR))
    .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
    .join(" | ");

  return alerts.length > 0 ? "error" : "ok";
}

describe("the sweep recognises a broken page", () => {
  it("calls a rendered ErrorState an error", () => {
    const { container } = render(
      <ErrorState
        title="Profile not available"
        message="Route GET /api/v1/profile does not exist"
      />,
    );

    expect(classify(container)).toBe("error");
  });

  it("calls a healthy page ok, whatever words it happens to contain", () => {
    // The wording that once caused a healthy page to be reported as broken.
    const { container } = render(
      <div>
        <p>Entity not available because the record was removed</p>
        <p>GET /api/v1/audit returned 200</p>
        <EmptyState
          title="Nothing here yet"
          description="Audit entries appear here."
        />
      </div>,
    );

    expect(classify(container)).toBe("ok");
  });

  it("does not mistake a skeleton or an empty state for a failure", () => {
    // Every page now renders a skeleton while it waits, so the sweep's
    // classifier sees one constantly. A skeleton is aria-hidden decoration plus
    // one sr-only label — it has almost no text, so a classifier keying on
    // character count would report a perfectly healthy page as broken.
    const { container: skeleton } = render(
      <SkeletonRegion label="Loading requests">
        <SkeletonList rows={6} />
      </SkeletonRegion>,
    );
    expect(classify(skeleton)).toBe("ok");
  });

  it("does not mistake a loading state or an empty state for a failure", () => {
    const { container: loading } = render(
      <Loading label="Loading your profile" />,
    );
    expect(classify(loading)).toBe("ok");

    const { container: empty } = render(
      <EmptyState title="No requests" description="None yet." />,
    );
    expect(classify(empty)).toBe("ok");
  });

  it("recognises an error even when the message is empty", () => {
    // A page that fails without an explanation is still a failure, and must
    // still be reported as one rather than as a healthy page with little on it.
    const { container } = render(<ErrorState title="Something went wrong" />);

    expect(classify(container)).toBe("error");
  });
});
