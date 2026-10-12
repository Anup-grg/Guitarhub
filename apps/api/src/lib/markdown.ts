/**
 * Tiny, strict Markdown → HTML renderer for user comments (SRS FR-4.4 / §6.6).
 *
 * Security posture (defense in depth):
 *  - Every input character is HTML-escaped *first*, so no raw HTML ever survives.
 *  - Only a fixed allowlist of tags is emitted (p, br, strong, em, del, code, pre,
 *    a, ul, ol, li, blockquote, h1–h6); we generate them ourselves.
 *  - Links are restricted to absolute http(s) URLs; unsafe schemes are dropped and
 *    the visible label is kept. Link counting lets callers enforce spam limits.
 *
 * `MARKDOWN_VERSION` is stored on each comment so bodies can be re-rendered when
 * the sanitizer changes (FR-4.4).
 */
export const MARKDOWN_VERSION = 1;

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ENTITIES[c] as string);
}

/** Only absolute http(s) URLs are used as link targets. */
function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!/^https?:\/\/[^ \t\r\n]+$/i.test(url)) return null;
  return url;
}

type LinkCounter = { count: number };

/** Inline formatting. `text` must already be HTML-escaped. */
function inline(text: string, links: LinkCounter): string {
  const stash: string[] = [];
  const store = (html: string): string => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  let out = text;

  // Inline code first so its contents are never re-formatted.
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => store(`<code>${code}</code>`));

  // Links [label](url) — unsafe schemes collapse to their label.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const safe = safeUrl(url);
    if (!safe) return label;
    links.count += 1;
    return store(
      `<a href="${safe}" rel="nofollow noopener noreferrer" target="_blank">${inline(label, links)}</a>`,
    );
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");

  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => stash[Number(i)] as string);
}

const BLOCK_START = /^(#{1,6}\s|>\s?|```|\s*[-*+]\s+|\s*\d+[.)]\s+)/;

export type MarkdownResult = { html: string; links: number };

/** Renders a Markdown comment to a safe, allowlisted HTML fragment. */
export function renderMarkdown(source: string): MarkdownResult {
  const links: LinkCounter = { count: 0 };
  const text = source.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  const lines = text.split("\n");
  const parts: string[] = [];
  const render = (raw: string): string => inline(escapeHtml(raw), links);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;

    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    const fence = line.match(/^```\s*\w*\s*$/);
    if (fence) {
      i += 1;
      const code: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i] as string)) {
        code.push(lines[i] as string);
        i += 1;
      }
      i += 1; // consume the closing fence (or EOF)
      parts.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1]!.length;
      parts.push(`<h${level}>${render(heading[2] as string)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] as string)) {
        quoted.push((lines[i] as string).replace(/^>\s?/, ""));
        i += 1;
      }
      parts.push(`<blockquote>${quoted.map((q) => render(q)).join("<br>")}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] as string)) {
        items.push(render((lines[i] as string).replace(/^\s*[-*+]\s+/, "")));
        i += 1;
      }
      parts.push(`<ul>${items.map((it) => `<li>${it}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i] as string)) {
        items.push(render((lines[i] as string).replace(/^\s*\d+[.)]\s+/, "")));
        i += 1;
      }
      parts.push(`<ol>${items.map((it) => `<li>${it}</li>`).join("")}</ol>`);
      continue;
    }

    // Paragraph: gather until a blank line or the next block starter.
    const para: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i] as string)) {
      if (para.length > 0 && BLOCK_START.test(lines[i] as string)) break;
      para.push(lines[i] as string);
      i += 1;
    }
    parts.push(`<p>${para.map((p) => render(p)).join("<br>")}</p>`);
  }

  return { html: parts.join("\n"), links: links.count };
}
