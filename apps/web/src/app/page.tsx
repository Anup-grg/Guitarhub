import { AdCarousel } from "@/components/ad-carousel";
import HomeFeeds from "@/components/home-feeds";
import { defaultAds } from "@/lib/ads";
import SiteHeader from "@/components/site-header";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Community preset sharing for multi-effects pedals
        </h1>
        <p className="mt-4 max-w-2xl leading-7 text-zinc-600 dark:text-zinc-400">
          Upload, discover and download presets for Line 6, Fractal, Boss, Neural DSP, Zoom, NUX and
          more — ranked by upvotes and comments from the community. Search the library or pick a
          pedal from the catalog.
        </p>

        <AdCarousel ads={defaultAds} autoAdvanceMs={12000} />

        <HomeFeeds />
      </main>
    </div>
  );
}
