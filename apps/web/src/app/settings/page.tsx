"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getCurrentUser, type SelfUser } from "@/lib/api";
import SiteHeader from "@/components/site-header";
import { ProfileSection } from "@/components/settings/profile";
import { SecuritySection } from "@/components/settings/security";
import { SessionsSection } from "@/components/settings/sessions";
import { DangerSection } from "@/components/settings/danger";

type Tab = "profile" | "security" | "sessions" | "danger";

const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "sessions", label: "Sessions" },
  { id: "danger", label: "Danger zone" },
];

export default function SettingsPage() {
  const [user, setUser] = useState<SelfUser | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [tab, setTab] = useState<Tab>("profile");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    profile: null,
    security: null,
    sessions: null,
    danger: null,
  });

  function selectTab(next: Tab) {
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  function onTabKeyDown(event: React.KeyboardEvent, current: Tab) {
    const index = TABS.findIndex((t) => t.id === current);
    let next: Tab | null = null;
    if (event.key === "ArrowRight") next = TABS[(index + 1) % TABS.length]!.id;
    else if (event.key === "ArrowLeft") next = TABS[(index - 1 + TABS.length) % TABS.length]!.id;
    else if (event.key === "Home") next = TABS[0]!.id;
    else if (event.key === "End") next = TABS[TABS.length - 1]!.id;
    if (next) {
      event.preventDefault();
      selectTab(next);
    }
  }

  useEffect(() => {
    getCurrentUser()
      .then((found) => (found ? setUser(found) : setSignedOut(true)))
      .catch(() => setSignedOut(true));
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Settings
        </h1>

        {signedOut ? (
          <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
            Sign in to manage your account.{" "}
            <Link href="/login" className="font-medium underline">
              Sign in
            </Link>
          </div>
        ) : !user ? (
          <p className="mt-6 text-sm text-zinc-500">Loading…</p>
        ) : (
          <>
            <nav
              className="mt-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800"
              role="tablist"
              aria-label="Account settings"
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[t.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`settings-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls="settings-panel"
                  tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  onKeyDown={(event) => onTabKeyDown(event, t.id)}
                  className={
                    tab === t.id
                      ? "border-b-2 border-zinc-900 px-4 py-2 text-sm font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                      : "border-b-2 border-transparent px-4 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                  }
                >
                  {t.label}
                </button>
              ))}
            </nav>

            <div
              className="mt-8"
              role="tabpanel"
              id="settings-panel"
              aria-labelledby={`settings-tab-${tab}`}
            >
              {tab === "profile" ? <ProfileSection user={user} onChange={setUser} /> : null}
              {tab === "security" ? <SecuritySection user={user} onChange={setUser} /> : null}
              {tab === "sessions" ? (
                <SessionsSection onSignedOutAll={() => setSignedOut(true)} />
              ) : null}
              {tab === "danger" ? <DangerSection onDeleted={() => setSignedOut(true)} /> : null}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
