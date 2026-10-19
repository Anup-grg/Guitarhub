import Link from "next/link";
import AuthNav from "@/components/auth-nav";

export default function SiteHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          GuitarHub
        </Link>
        <div className="flex items-center gap-4">
          <nav aria-label="Primary" className="flex items-center gap-3 text-sm">
            <Link
              href="/presets"
              className="font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
            >
              Browse
            </Link>
            <Link
              href="/pedals"
              className="font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
            >
              Pedals
            </Link>
            <Link
              href="/upload"
              className="font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
            >
              Upload
            </Link>
          </nav>
          {right}
          <AuthNav />
        </div>
      </div>
    </header>
  );
}
