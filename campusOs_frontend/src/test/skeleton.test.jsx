import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SkeletonForm,
  SkeletonHeading,
  SkeletonList,
  SkeletonPanel,
  SkeletonRegion,
  SkeletonStats,
  SkeletonText,
} from "../components/ui/Skeleton";

describe("skeletons", () => {
  /**
   * The accessibility contract, and the one thing that is easy to get wrong.
   *
   * A skeleton is dozens of divs. Without aria-hidden they are announced
   * individually, so a screen reader says nothing useful forty times before
   * anyone finds out the page is loading.
   */
  it("hides the decorative bars and announces the region once", () => {
    render(
      <SkeletonRegion label="Loading requests">
        <SkeletonList rows={6} />
      </SkeletonRegion>,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Loading requests…")).toHaveClass("sr-only");

    // Every bar is hidden from assistive technology, and there is only one
    // announced node.
    const bars = document.querySelectorAll('[aria-hidden="true"]');
    expect(bars.length).toBeGreaterThan(20);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("renders one row per requested row", () => {
    const { container } = render(<SkeletonList rows={4} />);
    // Each row is an avatar, two lines and a trailing status pill.
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(
      4 * 4,
    );
  });

  it("varies line widths so prose does not read as a table", () => {
    const { container } = render(<SkeletonText lines={3} />);
    const widths = [...container.querySelectorAll('[aria-hidden="true"]')].map(
      (el) => el.style.width,
    );
    // If every line were full width this would look like a grid, not a
    // paragraph. The last line is always short.
    expect(new Set(widths).size).toBeGreaterThan(1);
    expect(widths[widths.length - 1]).toBe("62%");
  });

  it("gives the last form field a textarea's height", () => {
    const { container } = render(<SkeletonForm fields={3} />);
    const fields = [
      ...container.querySelectorAll('[aria-hidden="true"]'),
    ].filter(
      (el) => el.className.includes("h-10") || el.className.includes("h-24"),
    );
    expect(fields).toHaveLength(3);
    expect(fields[2].className).toContain("h-24");
    expect(fields[0].className).toContain("h-10");
  });

  it("keeps a stable size for every list row", () => {
    const { container } = render(<SkeletonList rows={5} />);
    const rows = [...container.querySelectorAll(".py-4")];
    const heights = new Set(
      rows.map((row) => row.className.includes("px-4") && row.className),
    );
    // Every row must be the same class set; differing heights are exactly the
    // layout jump skeletons are supposed to prevent.
    expect(heights.size).toBe(1);
    expect(rows).toHaveLength(5);
  });

  it("nests panels inside a detail skeleton without losing the region", () => {
    render(
      <SkeletonRegion label="Loading request">
        <SkeletonHeading />
        <SkeletonPanel lines={3} />
        <SkeletonStats count={3} />
      </SkeletonRegion>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/Loading request/)).toBeInTheDocument();
  });
});
