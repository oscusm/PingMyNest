"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, BellOff, LogOut, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Navbar } from "@/components/landing/Navbar";
import { AlertChannels, ChangesFeed, CourseWatches } from "@/components/watches/AlertPanels";
import { usePingApi, type WatchItem } from "@/hooks/usePingApi";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

function statusChip(w: WatchItem) {
  if (!w.active) {
    return { label: "Notified", className: "text-muted", dot: "bg-muted" };
  }
  if (w.enrollment_available > 0) {
    return { label: "Open now", className: "text-open", dot: "bg-open" };
  }
  return { label: "Watching", className: "text-accent-ink", dot: "bg-accent" };
}

export default function WatchesPage() {
  const router = useRouter();
  const { sessionChecked, user, watches, listWatches, deleteWatch, watch, logout, error, clearError } =
    usePingApi();
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    if (!sessionChecked) return;
    if (!user) {
      router.replace("/signup");
      return;
    }
    void listWatches().catch(() => {
      /* error surfaced on hook */
    });
  }, [sessionChecked, user, listWatches, router]);

  const onRemove = async (classNbr: number) => {
    clearError();
    setPending(classNbr);
    try {
      await deleteWatch(classNbr);
    } catch {
      /* error surfaced on hook */
    } finally {
      setPending(null);
    }
  };

  // watches go inactive after the alert email; this turns one back on
  const onRewatch = async (classNbr: number) => {
    clearError();
    setPending(classNbr);
    try {
      await watch(classNbr);
      await listWatches();
    } catch {
      /* error surfaced on hook */
    } finally {
      setPending(null);
    }
  };

  // instructor/time/cancellation alerts outlast the seat alert
  const onToggleChanges = async (w: WatchItem) => {
    setPending(w.class_nbr);
    try {
      await api.setWatchChanges(w.class_nbr, !w.notify_changes);
      await listWatches();
    } catch {
      toast("Couldn't update that watch");
    } finally {
      setPending(null);
    }
  };

  const onLogout = async () => {
    try {
      await logout();
    } finally {
      router.replace("/");
    }
  };

  const loading = !sessionChecked || (user && watches === null);
  const activeCount = watches?.filter((w) => w.active).length ?? 0;
  const openCount = watches?.filter((w) => w.active && w.enrollment_available > 0).length ?? 0;
  const notifiedCount = watches?.filter((w) => !w.active).length ?? 0;

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-5xl font-bold text-ink sm:text-6xl">
                Your nest
              </h1>
              {user ? (
                <p className="mt-2 text-muted">
                  Alerts go to <span className="font-medium text-ink">{user.email}</span>
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              {user ? (
                <button type="button" onClick={() => void onLogout()} className="btn btn-ghost btn-sm">
                  <LogOut className="h-4 w-4" aria-hidden />
                  Sign out everywhere
                </button>
              ) : null}
              <Link href="/search" className="btn btn-primary btn-sm">
                <Plus className="h-4 w-4" aria-hidden />
                Add a class
              </Link>
            </div>
          </div>

          {watches && watches.length > 0 ? (
            <dl className="mt-8 grid grid-cols-3 divide-x divide-line rounded-md border border-line bg-surface">
              {[
                { label: "Watching", value: activeCount },
                { label: "Open now", value: openCount },
                { label: "Notified", value: notifiedCount },
              ].map((s) => (
                <div key={s.label} className="px-5 py-4">
                  <dt className="text-sm text-muted">{s.label}</dt>
                  <dd className="mt-1 text-2xl font-semibold tracking-tight text-ink">{s.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {error ? (
            <p className="mt-6 rounded-md bg-full-soft px-4 py-3 text-sm text-full" role="alert">
              {error}
            </p>
          ) : null}

          {loading ? (
            <ul className="mt-8 space-y-3">
              {[0, 1, 2].map((i) => (
                <li key={i} className="card flex items-center gap-4 p-5">
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-4 w-40 rounded" />
                    <div className="skeleton h-3 w-64 rounded" />
                  </div>
                  <div className="skeleton h-9 w-20 rounded-lg" />
                </li>
              ))}
            </ul>
          ) : watches && watches.length === 0 ? (
            <div className="mt-10 rounded-lg border border-dashed border-line-strong px-6 py-16 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-accent-soft text-accent-ink">
                <Bell className="h-5 w-5" aria-hidden />
              </span>
              <p className="mt-5 text-lg font-semibold text-ink">Your nest is empty</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
                Search for a full class and hit Ping me. We&apos;ll email you when a seat opens.
              </p>
              <Link href="/search" className="btn btn-accent btn-sm mt-6">
                Find a class
              </Link>
            </div>
          ) : (
            <ul className="mt-6 space-y-3">
              {watches?.map((w) => {
                const chip = statusChip(w);
                const busy = pending === w.class_nbr;
                return (
                  <li
                    key={w.id}
                    className={cn(
                      "card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between",
                      !w.active && "bg-bg shadow-none",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[17px] font-semibold tracking-tight text-ink">
                          {w.subject} {w.catalog_nbr}
                        </span>
                        <span className="font-mono text-xs text-muted">§{w.class_section}</span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider",
                            chip.className,
                          )}
                        >
                          <span className={cn("h-2 w-2", chip.dot)} aria-hidden />
                          {chip.label}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm text-ink-2">{w.descr}</p>
                      <p className="mt-1 font-mono text-xs text-muted">CRN {w.class_nbr}</p>
                      <label
                        className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-muted"
                        title="Email me if the instructor, meeting time, or section status changes"
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-[var(--color-ink)]"
                          checked={w.notify_changes}
                          disabled={busy}
                          onChange={() => void onToggleChanges(w)}
                        />
                        Alert me to changes
                      </label>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      {!w.active ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onRewatch(w.class_nbr)}
                          className="btn btn-secondary btn-sm"
                        >
                          <Bell className="h-4 w-4" aria-hidden />
                          Watch again
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onRemove(w.class_nbr)}
                        className="btn btn-ghost btn-sm hover:!bg-full-soft hover:!text-full"
                        aria-label={`Stop watching ${w.subject} ${w.catalog_nbr}-${w.class_section}`}
                      >
                        {w.active ? (
                          <BellOff className="h-4 w-4" aria-hidden />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden />
                        )}
                        {w.active ? "Stop" : "Remove"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {user ? (
            <>
              <CourseWatches />
              <ChangesFeed />
              <AlertChannels />
            </>
          ) : null}
        </div>
      </main>
    </>
  );
}
