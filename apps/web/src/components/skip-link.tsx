/**
 * WCAG 2.1.1 "Bypass Blocks": a hidden-till-focused link that jumps keyboard
 * users straight to the page's main content wrapper (`#main`).
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-zinc-900 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white dark:focus:bg-white dark:focus:text-zinc-900"
    >
      Skip to content
    </a>
  );
}
