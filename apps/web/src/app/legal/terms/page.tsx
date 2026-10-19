export const metadata = { title: "Terms of Service — GuitarHub" };

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12 font-sans text-sm leading-6 text-zinc-700 dark:text-zinc-300">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Terms of Service</h1>
      <p className="mt-1 text-xs text-zinc-500">Version 1.0 — effective at launch</p>

      <section className="mt-6 space-y-3">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">1. The service</h2>
        <p>
          GuitarHub is a community site for sharing presets for guitar multi-effects processors. You
          may browse, download, and — if you create an account — upload your own presets, comments
          and votes.
        </p>

        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">2. Your account</h2>
        <p>
          You are responsible for the activity on your account and for keeping your password secure.
          Provide accurate information, and tell us promptly if you believe your account has been
          compromised. You must be at least 13 years old to use GuitarHub.
        </p>

        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">3. What you upload</h2>
        <p>
          You retain ownership of the presets you upload. By uploading, you grant GuitarHub a
          worldwide, non-exclusive licence to host, display and distribute that content as part of
          the service. Do not upload content you do not have the right to share, including
          commercial IR captures or third-party samples you are not licensed to redistribute.
        </p>

        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">4. Acceptable use</h2>
        <p>
          Follow the Community Guidelines. We may remove content or suspend accounts that break
          these terms or the guidelines. Preset filenames and metadata may be moderated before they
          appear publicly.
        </p>

        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
          5. Availability and warranty
        </h2>
        <p>
          GuitarHub is provided &quot;as is&quot;. We do not guarantee uninterrupted availability or
          that any preset will sound a particular way on your rig. Firmware updates from pedal
          manufacturers may make older presets incompatible.
        </p>

        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">6. Changes</h2>
        <p>
          We will post material changes here and, for registered users, notify you by email before
          they take effect. Continued use after a change means you accept it.
        </p>
      </section>
    </main>
  );
}
