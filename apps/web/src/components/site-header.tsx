import Link from "next/link";
import AuthNav from "@/components/auth-nav";

export default function SiteHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center">
          <span className="text-2xl font-bold tracking-tight text-black">
            GUITARHUB
          </span>
        </Link>
        <div className="flex items-center gap-8">
          <nav aria-label="Primary" className="hidden lg:flex items-center gap-8 text-sm uppercase tracking-wide">
            <Link
              href="/"
              className="font-medium text-black hover:text-gray-600 transition-colors"
            >
              Home
            </Link>
            <Link
              href="/presets"
              className="font-medium text-gray-700 hover:text-black transition-colors"
            >
              Presets
            </Link>
            <Link
              href="/pedals"
              className="font-medium text-gray-700 hover:text-black transition-colors"
            >
              Pedals
            </Link>
            <Link
              href="/upload"
              className="font-medium text-gray-700 hover:text-black transition-colors"
            >
              Upload
            </Link>
            <Link
              href="/community"
              className="font-medium text-gray-700 hover:text-black transition-colors"
            >
              Community
            </Link>
          </nav>
          {right}
          <AuthNav />
        </div>
      </div>
    </header>
  );
}
