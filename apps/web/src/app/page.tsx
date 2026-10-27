import { AdCarousel } from "@/components/ad-carousel";
import HomeFeeds from "@/components/home-feeds";
import { defaultAds } from "@/lib/ads";
import SiteHeader from "@/components/site-header";
import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-white">
        <div className="mx-auto max-w-7xl">
          <div className="grid lg:grid-cols-2 min-h-[600px]">
            <div className="flex items-center px-6 py-16 lg:py-24 lg:pr-12">
              <div className="max-w-xl">
                <h1 className="text-5xl lg:text-6xl font-bold tracking-tight text-black leading-[1.1]">
                  THE ULTIMATE
                  <span className="block">DESTINATION</span>
                  <span className="block">FOR GUITAR</span>
                  <span className="block">PRESETS</span>
                </h1>
                <p className="mt-6 text-base text-gray-600 leading-relaxed max-w-md">
                  Discover, share and download premium presets for multi-effects pedals. 
                  Join the community of guitarists pushing the boundaries of tone.
                </p>
                <div className="mt-10 flex flex-col sm:flex-row gap-4">
                  <Link
                    href="/presets"
                    className="inline-flex items-center justify-center px-10 py-4 bg-black hover:bg-gray-900 text-white font-medium tracking-wide transition-colors"
                  >
                    BROWSE PRESETS
                  </Link>
                  <Link
                    href="/upload"
                    className="inline-flex items-center justify-center px-10 py-4 border-2 border-black hover:bg-black hover:text-white text-black font-medium tracking-wide transition-colors"
                  >
                    UPLOAD PRESET
                  </Link>
                </div>
              </div>
            </div>
            <div className="relative h-[400px] lg:h-auto">
              <Image
                src="/guitarist.jpg"
                alt="Guitarist playing guitar"
                fill
                className="object-cover object-[center_20%]"
                priority
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-white via-white/80 to-transparent lg:bg-gradient-to-r lg:from-white lg:via-transparent lg:to-transparent" />
            </div>
          </div>
        </div>
      </section>

      {/* Featured Section */}
      <section className="bg-[#f8f9fa] py-16">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-black mb-4">FEATURED PRESETS</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Hand-picked tones from our community of professional and amateur guitarists
            </p>
          </div>
          <AdCarousel ads={defaultAds} autoAdvanceMs={12000} />
        </div>
      </section>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-16">
        <HomeFeeds />
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="grid md:grid-cols-4 gap-8">
            <div className="md:col-span-2">
              <span className="text-xl font-bold text-black">GUITARHUB</span>
              <p className="mt-4 text-gray-600 max-w-md">
                The community-driven platform for sharing and discovering guitar presets.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-black mb-4">EXPLORE</h3>
              <ul className="space-y-2">
                <li><Link href="/presets" className="text-gray-600 hover:text-black">Presets</Link></li>
                <li><Link href="/pedals" className="text-gray-600 hover:text-black">Pedals</Link></li>
                <li><Link href="/upload" className="text-gray-600 hover:text-black">Upload</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-black mb-4">COMMUNITY</h3>
              <ul className="space-y-2">
                <li><Link href="#" className="text-gray-600 hover:text-black">About</Link></li>
                <li><Link href="#" className="text-gray-600 hover:text-black">Support</Link></li>
                <li><Link href="#" className="text-gray-600 hover:text-black">Guidelines</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-gray-200 text-center text-gray-600">
            <p>&copy; 2024 GuitarHub. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
