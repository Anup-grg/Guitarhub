# Ad Carousel Plan

## Observed reference (Daraz NP top banner style)

Based on Daraz layout, top banners are horizontal full-width hero images that rotate (carousel) with clickable links. Typical proportions ~1976x688px (wide banner). Clean, prominent.

## Proposed layout for GuitarHub home

- Place ad carousel directly under hero text on home page (between intro text and feeds).
- Use max-w-5xl container to match existing layout (px-6) for consistency.
- Aspect ratio: ~16:5 or 1976x688 style (e.g. h-40 sm:h-48 md:h-56 lg:h-64) with object-cover.
- Single image visible; clickable <a> to external site with target="_blank" rel="noopener noreferrer".
- Auto-advance every 12s; manual prev/next + dots; pause on hover; respect prefers-reduced-motion.

## Files to create/modify

- apps/web/src/lib/ads.ts: Ad type + defaultAds array
- apps/web/src/components/ad-carousel.tsx: client component with carousel logic
- apps/web/src/app/page.tsx: import and render AdCarousel

## Ad data structure

export type Ad = {
id: string;
imageUrl: string;
linkUrl: string;
alt?: string;
};
export const defaultAds: Ad[] = [
{ id: "ad-1", imageUrl: "https://placehold.co/1976x688.png?text=Ad+1", linkUrl: "https://example.com", alt: "Ad 1" },
{ id: "ad-2", imageUrl: "https://placehold.co/1976x688.png?text=Ad+2", linkUrl: "https://example.com/2", alt: "Ad 2" },
{ id: "ad-3", imageUrl: "https://placehold.co/1976x688.png?text=Ad+3", linkUrl: "https://example.com/3", alt: "Ad 3" },
];

## Implementation notes

- Use useEffect + setInterval for auto-advance (cleanup on unmount).
- Track index with useState; wrap around (index % ads.length).
- External links open in new tab safely.
- Keyboard accessible controls (aria labels).
- No new deps (pure React + Tailwind).
- respect prefers-reduced-motion via useReducedMotion or CSS.

## Integration

Add <AdCarousel ads={defaultAds} autoAdvanceMs={12000} /> after hero paragraph in apps/web/src/app/page.tsx.

## Testing plan

- Unit tests for carousel state/interval behavior (or simple render tests).
- Lint + typecheck + build all green.
