import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.js";

describe("renderMarkdown", () => {
  it("escapes raw HTML so no markup survives", () => {
    const { html } = renderMarkdown('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders bold, italic, strikethrough and inline code", () => {
    const { html } = renderMarkdown("**loud** *warm* ~~muddy~~ `gain: 5`");
    expect(html).toContain("<strong>loud</strong>");
    expect(html).toContain("<em>warm</em>");
    expect(html).toContain("<del>muddy</del>");
    expect(html).toContain("<code>gain: 5</code>");
  });

  it("counts links, allows http(s) and drops unsafe schemes", () => {
    const { html, links } = renderMarkdown(
      "see [docs](https://example.com/x) and [bad](javascript:alert(1))",
    );
    expect(links).toBe(1);
    expect(html).toContain('<a href="https://example.com/x"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("bad");
  });

  it("keeps markdown inside fenced code blocks literal", () => {
    const { html } = renderMarkdown("```\n**not bold** <b>\n```");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("**not bold** &lt;b&gt;");
    expect(html).not.toContain("<strong>");
  });

  it("renders headings, lists and blockquotes", () => {
    const { html } = renderMarkdown("# Title\n\n- one\n- two\n\n> quoted\n\n1. first");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<blockquote>quoted</blockquote>");
    expect(html).toContain("<ol><li>first</li></ol>");
  });

  it("joins single newlines as line breaks and splits paragraphs on blank lines", () => {
    const { html } = renderMarkdown("line one\nline two\n\nsecond para");
    expect(html).toContain("<p>line one<br>line two</p>");
    expect(html).toContain("<p>second para</p>");
  });
});
