import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkipLink } from "./skip-link";

describe("SkipLink", () => {
  it("links to the main content landmark wrapper", () => {
    render(
      <div>
        <SkipLink />
        <div id="main">Content</div>
      </div>,
    );
    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(link.getAttribute("href")).toBe("#main");
    expect(link.className).toContain("sr-only");
    expect(link.className).toContain("focus:not-sr-only");
  });
});