import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ad } from "@/lib/ads";
import { AdCarousel } from "./ad-carousel";

vi.mock("next/image", () => ({
  default: ({ src, alt, ...rest }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...rest} />
  ),
}));

const ads: Ad[] = [
  {
    id: "ad-1",
    imageUrl: "https://example.com/1.png",
    linkUrl: "https://example.com/1",
    alt: "Ad One",
  },
  {
    id: "ad-2",
    imageUrl: "https://example.com/2.png",
    linkUrl: "https://example.com/2",
    alt: "Ad Two",
  },
  {
    id: "ad-3",
    imageUrl: "https://example.com/3.png",
    linkUrl: "https://example.com/3",
    alt: "Ad Three",
  },
];

function stubMatchMedia(matches: boolean) {
  const matchMedia = (query: string): MediaQueryList =>
    ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: matchMedia,
  });
  vi.stubGlobal("matchMedia", matchMedia);
}

beforeEach(() => {
  stubMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AdCarousel", () => {
  it("renders the first ad with a safe external link", () => {
    render(<AdCarousel ads={ads} />);
    const link = screen.getByRole("link", { name: "Ad One" });
    expect(link.getAttribute("href")).toBe("https://example.com/1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("advances and wraps around with the next/prev controls", () => {
    render(<AdCarousel ads={ads} />);
    fireEvent.click(screen.getByRole("button", { name: "Next advertisement" }));
    expect(screen.getByRole("link", { name: "Ad Two" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous advertisement" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous advertisement" }));
    expect(screen.getByRole("link", { name: "Ad Three" })).toBeTruthy();
  });

  it("jumps to a specific ad via the dots", () => {
    render(<AdCarousel ads={ads} />);
    fireEvent.click(screen.getByRole("button", { name: "Go to advertisement 3" }));
    expect(screen.getByRole("link", { name: "Ad Three" })).toBeTruthy();
  });

  it("auto-advances on the configured interval", () => {
    vi.useFakeTimers();
    render(<AdCarousel ads={ads} autoAdvanceMs={12000} />);
    act(() => {
      vi.advanceTimersByTime(12000);
    });
    expect(screen.getByRole("link", { name: "Ad Two" })).toBeTruthy();
  });

  it("does not auto-advance when reduced motion is preferred", () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    render(<AdCarousel ads={ads} autoAdvanceMs={12000} />);
    act(() => {
      vi.advanceTimersByTime(36000);
    });
    expect(screen.getByRole("link", { name: "Ad One" })).toBeTruthy();
  });

  it("pauses auto-advance while hovered", () => {
    vi.useFakeTimers();
    const { container } = render(<AdCarousel ads={ads} autoAdvanceMs={12000} />);
    const region = container.querySelector("div") as HTMLElement;
    fireEvent.mouseEnter(region);
    act(() => {
      vi.advanceTimersByTime(36000);
    });
    expect(screen.getByRole("link", { name: "Ad One" })).toBeTruthy();
  });

  it("renders nothing when there are no ads", () => {
    const { container } = render(<AdCarousel ads={[]} />);
    expect(container.querySelector("section")).toBeNull();
  });
});
