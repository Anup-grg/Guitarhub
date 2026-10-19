export const metadata = { title: "Community Guidelines — GuitarHub" };

export default function CommunityGuidelinesPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12 font-sans text-sm leading-6 text-zinc-700 dark:text-zinc-300">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Community Guidelines
      </h1>
      <p className="mt-1 text-xs text-zinc-500">Version 1.0 — effective at launch</p>

      <section className="mt-6 space-y-3">
        <p>
          GuitarHub works when players help each other. These guidelines apply to presets, comments,
          votes, display names and profiles.
        </p>

        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Be constructive</h2>
        <p>
          Critique presets, not people. &quot;The gain staging clips on an LT knob at 7&quot; is
          useful; personal attacks are not. Harassment, hate speech and slurs are removed and may
          end your account.
        </p>

        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Share clean content</h2>
        <p>
          No malware, no ripped commercial preset packs, no infringing IR captures or amp models.
          Preset filenames and descriptions should not use other artists&apos; names to imply
          endorsement.
        </p>

        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Vote honestly</h2>
        <p>
          Upvote presets you genuinely find useful. Vote rings, mass downvoting rivals, or paying
          for votes will be treated as manipulation and reversed.
        </p>

        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Label your work</h2>
        <p>
          Note the target firmware version and any IRs a preset needs. If a preset only works on a
          specific board, say so in the description.
        </p>

        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Enforcement</h2>
        <p>
          We issue warnings where possible, then content removal, then suspension for repeat or
          serious offences. Decisions can be appealed by contacting the moderators; admins review
          moderation logs.
        </p>
      </section>
    </main>
  );
}
