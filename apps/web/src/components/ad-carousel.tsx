"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import type { Ad } from "../lib/ads";

type AdCarouselProps = {
  ads: Ad[];
  autoAdvanceMs?: number;
};

export function AdCarousel({ ads, autoAdvanceMs = 12000 }: AdCarouselProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = ads.length;

  const goTo = useCallback(
    (i: number) => {
      if (total === 0) return;
      setIndex(((i % total) + total) % total);
    },
    [total],
  );

  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  useEffect(() => {
    if (typeof window === "undefined" || total <= 1 || paused) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const id = setInterval(next, autoAdvanceMs);
    return () => clearInterval(id);
  }, [next, total, autoAdvanceMs, paused]);

  if (total === 0) return null;

  const current = ads[index];

  return (
    <section className="mt-6" aria-label="Advertisement carousel">
      <div
        className="relative overflow-hidden rounded-lg"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <a
          href={current.linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="relative block h-40 sm:h-48 md:h-56 lg:h-64"
          aria-label={current.alt || "Advertisement"}
        >
          <Image
            src={current.imageUrl}
            alt={current.alt || "Advertisement"}
            fill
            unoptimized
            sizes="(max-width: 1024px) 100vw, 1024px"
            className="object-cover"
          />
        </a>
        {total > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded bg-black/40 px-2 py-1 text-white hover:bg-black/60"
              aria-label="Previous advertisement"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={next}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-black/40 px-2 py-1 text-white hover:bg-black/60"
              aria-label="Next advertisement"
            >
              ›
            </button>
            <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
              {ads.map((ad, i) => (
                <button
                  key={ad.id}
                  type="button"
                  onClick={() => goTo(i)}
                  className={`h-2 w-2 rounded-full ${i === index ? "bg-white" : "bg-white/50"}`}
                  aria-label={`Go to advertisement ${i + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
