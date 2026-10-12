import { describe, expect, it } from "vitest";
import { MARKDOWN_VERSION } from "./markdown.js";
import { commentHtml, serializeComment, type CommentRow } from "./comments.js";

function row(overrides: Partial<CommentRow> = {}): CommentRow {
  return {
    id: "c_1",
    presetId: "p_1",
    userId: "u_1",
    parentId: null,
    bodyMd: "**hot** tone",
    bodyHtml: "<p><strong>hot</strong> tone</p>",
    bodyHtmlVersion: MARKDOWN_VERSION,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

const author = { id: "u_1", displayName: "Alice", verified: true };

describe("commentHtml (FR-4.4 re-render gate)", () => {
  it("returns the stored html when the sanitizer version matches", () => {
    expect(commentHtml(row())).toBe("<p><strong>hot</strong> tone</p>");
  });

  it("re-renders from markdown when the stored version is stale", () => {
    const stale = row({ bodyHtmlVersion: MARKDOWN_VERSION - 1 });
    expect(commentHtml(stale)).toBe("<p><strong>hot</strong> tone</p>");
  });

  it("re-renders older content through the sanitizer for defense in depth", () => {
    const dirty = row({
      bodyHtmlVersion: 0,
      bodyMd: "<script>x</script>",
      bodyHtml: "<script>x</script>",
    });
    const html = commentHtml(dirty);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("serializeComment", () => {
  it("exposes body, author and an empty reply list for a live comment", () => {
    const out = serializeComment(row(), author);
    expect(out.deleted).toBe(false);
    expect(out.bodyMd).toBe("**hot** tone");
    expect(out.bodyHtml).toBe("<p><strong>hot</strong> tone</p>");
    expect(out.author).toEqual(author);
    expect(out.parentId).toBeNull();
    expect(out.replies).toEqual([]);
  });

  it("hides body and author for soft-deleted comments", () => {
    const out = serializeComment(row({ deletedAt: new Date("2026-01-02T00:00:00Z") }), author);
    expect(out.deleted).toBe(true);
    expect(out.bodyMd).toBeNull();
    expect(out.bodyHtml).toBeNull();
    expect(out.author).toBeNull();
  });

  it("normalises an empty parentId to null", () => {
    const out = serializeComment(row({ parentId: null }), author);
    expect(out.parentId).toBeNull();
  });

  it("passes replies through unchanged", () => {
    const reply = serializeComment(row({ id: "c_2", parentId: "c_1" }), author);
    const out = serializeComment(row(), author, [reply]);
    expect(out.replies).toHaveLength(1);
    expect(out.replies[0]?.id).toBe("c_2");
  });
});